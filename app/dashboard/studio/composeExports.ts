import { drawLayout, drawPortraitStacked } from './layouts';
import { formatForStream, pickExportRecordingFormat } from './recordingFormat';
import { ORIENTATION_DIMS, type CanvasWithCapture, type CompositorConfig } from './types';

const FPS = 30;
const MIN_RENDER_INTERVAL_MS = 1000 / FPS - 2;
const LANDSCAPE_BITRATE = 8_000_000;
const PORTRAIT_BITRATE = 6_000_000;
const CANVAS_CONTEXT_OPTIONS: CanvasRenderingContext2DSettings = { alpha: false };

export interface ComposeExportsParams {
  screenBlob: Blob;
  cameraBlob: Blob;
  config: CompositorConfig;
  makePortrait: boolean;
  // Duration of the raw take (ms) — WebM blobs from MediaRecorder often report
  // duration: Infinity, so we drive the progress bar off the known elapsed time.
  expectedDurationMs: number;
  // AudioContext created during the Record click. Chrome only lets a context
  // start 'running' when it is created inside a user gesture on the page —
  // compose often runs with no gesture available (recording stopped from the
  // native "Stop sharing" bar), and a context created suspended here would mix
  // pure silence into both exports.
  audioCtx?: AudioContext | null;
  onProgress?: (fraction: number) => void;
}

// HTMLMediaElement.captureStream() exists in Chrome but not in lib.dom here.
type ElementWithCapture = HTMLVideoElement & { captureStream?: () => MediaStream };

export interface ComposeExportsResult {
  landscape: Blob;
  portrait: Blob | null;
  mimeType: string;
}

function loadVideo(blob: Blob): { video: HTMLVideoElement; url: string; ready: Promise<void> } {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.src = url;
  // Do NOT mute this element. In Chrome, muting an element also silences the
  // MediaElementAudioSourceNode created from it below — the mic/system audio
  // would never reach the export at all. createMediaElementSource already
  // detaches the element's output from the speakers once connected to a
  // Web Audio graph, so nothing becomes audible during processing anyway.
  video.volume = 1;
  video.playsInline = true;
  video.preload = 'auto';
  // Kept in the DOM but off-screen: a detached / display:none video can be
  // suspended and never advance its frames, which would freeze the composite.
  video.style.cssText =
    'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;';
  document.body.appendChild(video);
  const ready = new Promise<void>((resolve, reject) => {
    const onReady = () => resolve();
    video.addEventListener('loadeddata', onReady, { once: true });
    video.addEventListener('error', () => reject(new Error('Could not decode a recorded take')), {
      once: true,
    });
  });
  return { video, url, ready };
}

function recorderFor(stream: MediaStream, bitrate: number, mimeType: string) {
  const chunks: Blob[] = [];
  const rec = new MediaRecorder(stream, {
    mimeType: mimeType || undefined,
    videoBitsPerSecond: bitrate,
  });
  const actualMimeType = rec.mimeType || mimeType || 'video/webm';
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const done = new Promise<Blob>((resolve) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: actualMimeType }));
  });
  return { rec, done, mimeType: actualMimeType };
}

/**
 * Offline re-composite. Replays the raw screen + camera takes and paints the
 * landscape (drawLayout) and, optionally, portrait (drawPortraitStacked) cuts
 * onto their own canvases, recording each. Because this runs after the live
 * capture, there is CPU headroom, so the composite that was too heavy to run
 * live during a screen-share comes out clean. Audio (mic from the camera take +
 * system from the screen take) is merged through the Web Audio graph — using
 * createMediaElementSource keeps playback silent while still recording it.
 */
export async function composeExports({
  screenBlob,
  cameraBlob,
  config,
  makePortrait,
  expectedDurationMs,
  audioCtx: providedAudioCtx,
  onProgress,
}: ComposeExportsParams): Promise<ComposeExportsResult> {
  const format = pickExportRecordingFormat();
  const mimeType = format.mimeType;
  const screen = loadVideo(screenBlob);
  const camera = loadVideo(cameraBlob);
  await Promise.all([screen.ready, camera.ready]);

  // Diagnostics: this is how a face-only / silent export regression gets
  // caught next time instead of only surfacing as a user report.
  console.info('[Studio compose]', {
    screen: {
      sourceMimeType: screenBlob.type,
      videoWidth: screen.video.videoWidth,
      videoHeight: screen.video.videoHeight,
      duration: screen.video.duration,
      readyState: screen.video.readyState,
    },
    camera: {
      sourceMimeType: cameraBlob.type,
      videoWidth: camera.video.videoWidth,
      videoHeight: camera.video.videoHeight,
      duration: camera.video.duration,
      readyState: camera.video.readyState,
    },
    exportMimeType: mimeType || 'browser default',
  });

  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const audioCtx = providedAudioCtx ?? (AudioCtx ? new AudioCtx() : null);
  await audioCtx?.resume().catch(() => {});
  const mixerRunning = audioCtx?.state === 'running';
  const outputs = makePortrait ? 2 : 1;
  // One mixed audio track per export (landscape / portrait).
  const exportAudioTracks: (MediaStreamTrack | undefined)[] = [];
  let audioPath: 'web-audio-mix' | 'element-capture' | 'none' = 'none';
  if (audioCtx && mixerRunning) {
    const dests = Array.from({ length: outputs }, () => audioCtx.createMediaStreamDestination());
    // Both takes may carry audio (camera → mic, screen → system). A take with no
    // audio track just contributes silence; connecting it is harmless.
    for (const el of [camera.video, screen.video]) {
      try {
        const node = audioCtx.createMediaElementSource(el);
        dests.forEach((d) => node.connect(d));
      } catch {
        /* element unsupported for capture — skip its audio */
      }
    }
    dests.forEach((d, i) => {
      exportAudioTracks[i] = d.stream.getAudioTracks()[0];
    });
    audioPath = 'web-audio-mix';
  } else {
    // Last resort so the exports are never silent: tap the element's audio via
    // captureStream(), which needs no AudioContext. Only one take can feed each
    // export this way, so the mic (camera take) wins over system audio. The
    // element is not rerouted into a graph on this path, so the take is audible
    // through the speakers while processing — acceptable for an emergency path.
    const capture = (el: HTMLVideoElement) =>
      (el as ElementWithCapture).captureStream?.().getAudioTracks()[0];
    const track = capture(camera.video) ?? capture(screen.video);
    if (track) {
      exportAudioTracks[0] = track;
      if (outputs > 1) exportAudioTracks[1] = track.clone();
      audioPath = 'element-capture';
    }
  }
  console.info('[Studio compose] audio', {
    audioContextState: audioCtx?.state ?? 'unavailable',
    providedByRecordClick: !!providedAudioCtx,
    audioPath,
    exportAudioTrackCount: exportAudioTracks.filter(Boolean).length,
  });

  const land = ORIENTATION_DIMS.landscape;
  const port = ORIENTATION_DIMS.portrait;
  const landscapeCanvas = document.createElement('canvas');
  landscapeCanvas.width = land.width;
  landscapeCanvas.height = land.height;
  const landscapeCtx = landscapeCanvas.getContext('2d', CANVAS_CONTEXT_OPTIONS)!;

  let portraitCanvas: HTMLCanvasElement | null = null;
  let portraitCtx: CanvasRenderingContext2D | null = null;
  if (makePortrait) {
    portraitCanvas = document.createElement('canvas');
    portraitCanvas.width = port.width;
    portraitCanvas.height = port.height;
    portraitCtx = portraitCanvas.getContext('2d', CANVAS_CONTEXT_OPTIONS);
  }

  const landscapeStream = (landscapeCanvas as CanvasWithCapture).captureStream(FPS);
  if (exportAudioTracks[0]) {
    landscapeStream.addTrack(exportAudioTracks[0]);
  }
  const landscapeFormat = formatForStream(format, landscapeStream);
  const landscapeRec = recorderFor(landscapeStream, LANDSCAPE_BITRATE, landscapeFormat.mimeType);

  let portraitRec: ReturnType<typeof recorderFor> | null = null;
  let portraitStream: MediaStream | null = null;
  if (portraitCanvas) {
    portraitStream = (portraitCanvas as CanvasWithCapture).captureStream(FPS);
    if (exportAudioTracks[1]) {
      portraitStream.addTrack(exportAudioTracks[1]);
    }
    const portraitFormat = formatForStream(format, portraitStream);
    portraitRec = recorderFor(portraitStream, PORTRAIT_BITRATE, portraitFormat.mimeType);
  }

  // First frame before the recorders start so neither opens on a blank canvas.
  const paint = () => {
    drawLayout(landscapeCtx, land, config, screen.video, camera.video);
    if (portraitCtx) drawPortraitStacked(portraitCtx, port, screen.video, camera.video);
  };
  paint();

  landscapeRec.rec.start();
  portraitRec?.rec.start();

  let lastRenderAt = 0;
  let raf = 0;
  const tick = () => {
    const now = performance.now();
    if (now - lastRenderAt >= MIN_RENDER_INTERVAL_MS) {
      lastRenderAt = now;
      paint();
      if (onProgress && expectedDurationMs > 0) {
        onProgress(Math.min(1, (camera.video.currentTime * 1000) / expectedDurationMs));
      }
    }
  };
  // The paint loop must be driven by a Web Worker timer, not rAF: Chrome
  // freezes rAF in a hidden tab, and processing often runs while the user is
  // in another app (recording stopped from the "Stop sharing" bar). A frozen
  // loop kept recording one stale canvas frame while audio played on — the
  // "video frozen for 30-50s, audio perfect" exports. Same fix as the live
  // compositor's watchdog (see tick.worker.ts).
  const startLoop = (): Worker | null => {
    try {
      const w = new Worker(new URL('./tick.worker.ts', import.meta.url));
      w.onmessage = tick;
      w.postMessage({ type: 'start', fps: FPS });
      return w;
    } catch {
      const loop = () => {
        tick();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      return null;
    }
  };

  const ended = new Promise<void>((resolve) => {
    let remaining = 2;
    const one = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
    };
    screen.video.addEventListener('ended', one, { once: true });
    camera.video.addEventListener('ended', one, { once: true });
  });

  screen.video.currentTime = 0;
  camera.video.currentTime = 0;
  await Promise.all([screen.video.play(), camera.video.play()]);
  const worker = startLoop();

  await ended;
  if (worker) {
    worker.postMessage({ type: 'stop' });
    worker.terminate();
  }
  if (raf) cancelAnimationFrame(raf);
  // Flush one final frame, then stop.
  paint();
  landscapeRec.rec.stop();
  portraitRec?.rec.stop();

  const landscape = await landscapeRec.done;
  const portrait = portraitRec ? await portraitRec.done : null;
  onProgress?.(1);

  // Teardown — free decoders, audio graph and object URLs.
  audioCtx?.close().catch(() => {});
  for (const v of [screen.video, camera.video]) {
    v.removeAttribute('src');
    v.load();
    v.remove();
  }
  URL.revokeObjectURL(screen.url);
  URL.revokeObjectURL(camera.url);

  return { landscape, portrait, mimeType: landscapeRec.mimeType };
}
