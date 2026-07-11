'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Camera,
  Circle,
  Download,
  Mic,
  Monitor,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  Smartphone,
  Square,
  SwitchCamera,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useMediaStreams } from './useMediaStreams';
import { useCompositor } from './useCompositor';
import { useRecorder } from './useRecorder';
import { useStudioHotkeys } from './useHotkeys';
import { useDocumentPip, useDocumentPipSupported } from './useDocumentPip';
import { SelfViewPip } from './SelfViewPip';
import { mergeAudioTracks } from './audio';
import type { CompositorConfig, CanvasWithCapture, LayoutId, StudioPhase } from './types';
import { ORIENTATION_DIMS } from './types';

const LANDSCAPE_BITRATE = 8_000_000;
const PORTRAIT_BITRATE = 6_000_000;
const PORTRAIT_DIMS = ORIENTATION_DIMS.portrait;

const noopSubscribe = () => () => {};
// Screen capture (getDisplayMedia) is absent in all iOS browsers and some
// mobile browsers. Read it via an external store: the server snapshot assumes
// support (desktop layout), then the client re-renders to the real value with
// no hydration mismatch and no setState-in-effect.
function useScreenCaptureSupported(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () =>
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getDisplayMedia === 'function',
    () => true,
  );
}

const LANDSCAPE_CONFIG: CompositorConfig = {
  layout: 1,
  orientation: 'landscape',
  bubblePosition: 'bottom-right',
  bubbleSize: 'medium',
};
const CAMERA_ONLY_CONFIG: CompositorConfig = {
  layout: 2,
  orientation: 'portrait',
  bubblePosition: 'bottom-right',
  bubbleSize: 'medium',
};

const LAYOUT_META: Record<LayoutId, { label: string; needsScreen: boolean }> = {
  1: { label: 'Screen + cam', needsScreen: true },
  2: { label: 'Camera', needsScreen: false },
  3: { label: 'Screen', needsScreen: true },
};

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function makeFilename(kind?: string): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}`;
  return `cerebro-studio-${stamp}${kind ? `-${kind}` : ''}.webm`;
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DARK_BTN =
  'inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-[#080808] text-white hover:bg-[#242424] transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const LIGHT_BTN =
  'inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium border border-black/15 text-black/80 hover:bg-black/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

export default function StudioApp() {
  const [phase, setPhase] = useState<StudioPhase>('setup');
  const [selectedCamera, setSelectedCamera] = useState('');
  const [selectedMic, setSelectedMic] = useState('');
  const [systemAudio, setSystemAudio] = useState(false);
  // Also record a portrait (9:16) cut alongside the landscape take. Desktop
  // (screen+face) only — camera-only mode is already a single portrait video.
  // Defaults ON: Pedro records once and downloads BOTH landscape (YouTube) and
  // portrait (LinkedIn). Do NOT default this off for performance — the lag fix
  // comes from the pipeline rebuild (P1/P2), not from removing the dual export.
  const [makePortrait, setMakePortrait] = useState(true);
  // Desktop layout: 1 screen+cam bubble, 2 camera only, 3 screen only.
  const [layout, setLayout] = useState<LayoutId>(1);
  const [countdown, setCountdown] = useState<number | null>(null);
  // Camera-only mode: mobile browsers have no getDisplayMedia (screen capture),
  // so Studio becomes a portrait talking-head recorder instead of dead-ending.
  const cameraOnly = !useScreenCaptureSupported();
  const config = useMemo<CompositorConfig>(
    () => (cameraOnly ? CAMERA_ONLY_CONFIG : { ...LANDSCAPE_CONFIG, layout }),
    [cameraOnly, layout],
  );
  const dualExport = !cameraOnly && makePortrait;

  const {
    cameras,
    mics,
    camMicStream,
    screenStream,
    camMicError,
    screenError,
    startCamMic,
    switchCamera,
    startScreen,
    stopAll,
    registerScreenEnded,
  } = useMediaStreams(config.orientation);

  const recorder = useRecorder();
  const portraitRecorder = useRecorder();

  const pipSupported = useDocumentPipSupported();
  const { pipWindow, open: openPip, close: closePip } = useDocumentPip();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const portraitCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const configRef = useRef(config);
  const phaseRef = useRef<StudioPhase>(phase);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const portraitStreamRef = useRef<MediaStream | null>(null);
  const pendingStopsRef = useRef(0);
  const countdownRef = useRef<number | null>(null);
  const audioCleanupRef = useRef<(() => void) | null>(null);

  // Stop both takes together. Safe when portrait wasn't started — an unstarted
  // recorder's stop() is a no-op.
  const stopRecording = useCallback(() => {
    recorder.stop();
    portraitRecorder.stop();
  }, [recorder, portraitRecorder]);

  const pauseRecording = useCallback(() => {
    recorder.pause();
    portraitRecorder.pause();
  }, [recorder, portraitRecorder]);

  const resumeRecording = useCallback(() => {
    recorder.resume();
    portraitRecorder.resume();
  }, [recorder, portraitRecorder]);

  useEffect(() => {
    configRef.current = config;
  }, [config]);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useCompositor({
    canvasRef,
    screenVideoRef,
    cameraVideoRef,
    configRef,
    active: phase === 'setup' || phase === 'recording',
    portraitCanvasRef,
    portraitActive: dualExport,
  });

  // Acquire camera + mic. Keyed on orientation so that when a mobile browser
  // resolves to camera-only (portrait) after hydration, the first stream is
  // re-acquired in portrait instead of a cropped landscape frame. Desktop stays
  // landscape and runs once.
  useEffect(() => {
    void startCamMic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.orientation]);

  // Bind streams to the hidden source videos the compositor draws from.
  useEffect(() => {
    const v = cameraVideoRef.current;
    if (!v) return;
    v.srcObject = camMicStream;
    v.muted = true;
    if (camMicStream) v.play().catch(() => {});
  }, [camMicStream]);

  useEffect(() => {
    const v = screenVideoRef.current;
    if (!v) return;
    v.srcObject = screenStream;
    v.muted = true;
    if (screenStream) v.play().catch(() => {});
  }, [screenStream]);

  // Native "Stop sharing" → finalize gracefully instead of losing footage.
  useEffect(() => {
    registerScreenEnded(() => {
      if (phaseRef.current === 'recording') stopRecording();
    });
    return () => registerScreenEnded(null);
  }, [registerScreenEnded, stopRecording]);

  // Called once both recordings have stopped: review the take and free every
  // capture source so no camera light lingers.
  const finalizeRecording = useCallback(() => {
    audioCleanupRef.current?.();
    audioCleanupRef.current = null;
    recordingStreamRef.current?.getTracks().forEach((t) => t.stop());
    recordingStreamRef.current = null;
    portraitStreamRef.current?.getTracks().forEach((t) => t.stop());
    portraitStreamRef.current = null;
    stopAll();
    setPhase('review');
  }, [stopAll]);

  // Landscape and portrait recorders stop independently; finalize only after
  // the last one has flushed its blob so neither take is truncated.
  const handleRecorderComplete = useCallback(() => {
    pendingStopsRef.current -= 1;
    if (pendingStopsRef.current <= 0) finalizeRecording();
  }, [finalizeRecording]);

  const handleShareScreen = useCallback(() => {
    void startScreen(systemAudio);
  }, [startScreen, systemAudio]);

  const startRecording = useCallback(() => {
    closePip();
    const canvas = canvasRef.current as CanvasWithCapture | null;
    if (!canvas || !camMicStream) return;
    if (!cameraOnly && !screenStream) return;

    const portraitCanvas = portraitCanvasRef.current as CanvasWithCapture | null;
    const portraitStream = dualExport && portraitCanvas ? portraitCanvas.captureStream(30) : null;
    const primaryStream = canvas.captureStream(30);

    const screenAudioAvailable = Boolean(systemAudio && screenStream?.getAudioTracks().length);
    if (screenAudioAvailable) {
      const audio = mergeAudioTracks([camMicStream, screenStream], portraitStream ? 2 : 1);
      audioCleanupRef.current = audio.cleanup;
      if (audio.tracks[0]) primaryStream.addTrack(audio.tracks[0]);
      if (portraitStream && audio.tracks[1]) portraitStream.addTrack(audio.tracks[1]);
    } else {
      const micTrack = camMicStream.getAudioTracks()[0];
      audioCleanupRef.current = null;
      if (micTrack) {
        primaryStream.addTrack(micTrack);
        if (portraitStream) portraitStream.addTrack(micTrack);
      }
    }

    recordingStreamRef.current = primaryStream;
    portraitStreamRef.current = portraitStream;

    const primaryBitrate = config.orientation === 'portrait' ? PORTRAIT_BITRATE : LANDSCAPE_BITRATE;
    pendingStopsRef.current = portraitStream ? 2 : 1;
    recorder.start(primaryStream, primaryBitrate, handleRecorderComplete);
    if (portraitStream) portraitRecorder.start(portraitStream, PORTRAIT_BITRATE, handleRecorderComplete);
    setPhase('recording');
  }, [
    camMicStream,
    screenStream,
    systemAudio,
    cameraOnly,
    dualExport,
    config.orientation,
    recorder,
    portraitRecorder,
    handleRecorderComplete,
    closePip,
  ]);

  // Toggle to the other camera (laptop <-> phone, or front/back on mobile). Uses
  // the audio-safe video-track swap so it also works mid-recording.
  const flipCamera = useCallback(() => {
    if (cameras.length < 2) return;
    const currentId = camMicStream?.getVideoTracks()[0]?.getSettings().deviceId;
    const next = cameras.find((c) => c.deviceId !== currentId) ?? cameras[0];
    setSelectedCamera(next.deviceId);
    void switchCamera(next.deviceId);
  }, [cameras, camMicStream, switchCamera]);

  const returnToSetup = useCallback(() => {
    recorder.reset();
    portraitRecorder.reset();
    setPhase('setup');
    void startCamMic(selectedCamera || undefined, selectedMic || undefined);
  }, [recorder, portraitRecorder, startCamMic, selectedCamera, selectedMic]);

  const downloadBlob = useCallback((url: string, kind?: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = makeFilename(kind);
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  const canRecord = cameraOnly ? !!camMicStream : !!camMicStream && !!screenStream;

  const cancelCountdown = useCallback(() => {
    if (countdownRef.current !== null) {
      window.clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setCountdown(null);
  }, []);

  // 3-2-1 overlay on the preview, then start recording. The count is a React
  // overlay, never drawn on the canvas, so it is not baked into the take.
  const beginCountdown = useCallback(() => {
    if (!canRecord || countdownRef.current !== null) return;
    closePip();
    let n = 3;
    setCountdown(n);
    countdownRef.current = window.setInterval(() => {
      n -= 1;
      if (n <= 0) {
        window.clearInterval(countdownRef.current!);
        countdownRef.current = null;
        setCountdown(null);
        startRecording();
      } else {
        setCountdown(n);
      }
    }, 1000);
  }, [canRecord, startRecording, closePip]);

  useEffect(() => () => cancelCountdown(), [cancelCountdown]);

  const cycleLayout = useCallback(() => setLayout((l) => ((l % 3) + 1) as LayoutId), []);

  const onEscape = useCallback(() => {
    if (countdownRef.current !== null) cancelCountdown();
    else if (phaseRef.current === 'recording') stopRecording();
  }, [cancelCountdown, stopRecording]);

  useStudioHotkeys({
    enabled: !cameraOnly && (phase === 'setup' || phase === 'recording'),
    onLayout: setLayout,
    onCycle: cycleLayout,
    onEscape,
  });

  // Mirror the hotkeys onto the floating window so 1/2/3, Space and Esc work
  // while it is focused. (A browser tab can't capture keys while a different app
  // holds focus, so the floating window's own buttons cover that case.)
  useStudioHotkeys({
    enabled: !!pipWindow && !cameraOnly && phase === 'setup',
    onLayout: setLayout,
    onCycle: cycleLayout,
    onEscape,
    target: pipWindow,
  });

  const togglePip = useCallback(() => {
    if (pipWindow) closePip();
    else void openPip({ width: 240, height: 320 });
  }, [pipWindow, closePip, openPip]);

  // The floating self-view is only safe before recording. When sharing "Entire
  // Screen", any floating OS/browser window becomes part of the captured pixels,
  // so close it before/during recording to keep the export clean.
  useEffect(() => {
    if (phase !== 'setup') closePip();
  }, [phase, closePip]);

  // Portrait stage on mobile hugs a 9:16 box capped to the viewport height;
  // landscape fills the grid cell at 16:9 as before.
  const isPortrait = config.orientation === 'portrait';
  const stageBox = isPortrait
    ? 'mx-auto aspect-[9/16] h-[68vh] max-w-full'
    : 'w-full aspect-video';
  const canvasDims = ORIENTATION_DIMS[config.orientation];

  // Derive the dropdown selection from the live stream so it reflects the
  // browser's default device until the user explicitly picks one.
  const cameraValue = selectedCamera || camMicStream?.getVideoTracks()[0]?.getSettings().deviceId || '';
  const micValue = selectedMic || camMicStream?.getAudioTracks()[0]?.getSettings().deviceId || '';

  return (
    <div className="cerebro-studio p-4 sm:p-6 md:p-8">
      <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black/40 mb-2">
        Cerebro
      </p>
      <div className="mb-6 flex items-end justify-between gap-4 sm:mb-8">
        <h1 className="font-display text-3xl font-light tracking-[-0.02em] text-black">Studio</h1>
        <p className="hidden max-w-xs text-right text-xs leading-relaxed text-black/45 sm:block">
          {cameraOnly
            ? 'Record your camera, right here in your browser — nothing is uploaded.'
            : 'Record your screen with your face in a bubble. Everything stays in your browser — no uploads.'}
        </p>
      </div>

      {camMicError && (
        <ErrorBanner
          message={camMicError}
          onRetry={() => void startCamMic(selectedCamera || undefined, selectedMic || undefined)}
        />
      )}
      {screenError && !cameraOnly && phase !== 'recording' && (
        <ErrorBanner message={screenError} onRetry={handleShareScreen} />
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        {/* Left column: landscape stage + optional portrait-cut preview */}
        <div className="space-y-4">
        {/* Stage — the exact frame that records */}
        <div
          className={`relative overflow-hidden rounded-2xl bg-[#111] shadow-[0_18px_45px_-28px_rgba(0,0,0,0.6)] ${stageBox}`}
        >
          {/* Source feeds the compositor draws from. Mounted full-size and
              fully opaque so Chrome keeps decoding the camera (a hidden or
              transparent camera feed is suspended); the opaque canvas paints
              on top, so these are never actually seen. */}
          <video
            ref={screenVideoRef}
            autoPlay
            muted
            playsInline
            className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover"
          />
          <video
            ref={cameraVideoRef}
            autoPlay
            muted
            playsInline
            className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover"
          />

          <canvas
            ref={canvasRef}
            width={canvasDims.width}
            height={canvasDims.height}
            className="absolute inset-0 z-10 block h-full w-full"
          />

          {phase !== 'review' && !cameraOnly && LAYOUT_META[config.layout].needsScreen && !screenStream && (
            <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 text-center">
              <Monitor className="h-8 w-8 text-white/50" strokeWidth={1.4} />
              <p className="max-w-xs px-6 text-sm text-white/70">
                Share your screen to see the {LAYOUT_META[config.layout].label} preview.
              </p>
            </div>
          )}

          {phase !== 'review' && cameraOnly && !camMicStream && (
            <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 text-center">
              <Camera className="h-8 w-8 text-white/50" strokeWidth={1.4} />
              <p className="max-w-xs px-6 text-sm text-white/70">Starting your camera…</p>
            </div>
          )}

          {countdown !== null && (
            <button
              type="button"
              onClick={cancelCountdown}
              className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-black/45 backdrop-blur-sm"
            >
              <span className="font-display text-8xl font-light tabular-nums text-white">
                {countdown}
              </span>
              <span className="text-xs uppercase tracking-[0.2em] text-white/60">
                Tap or press Esc to cancel
              </span>
            </button>
          )}

          {phase === 'recording' && (
            <div className="absolute left-4 top-4 z-20 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 backdrop-blur-sm">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  recorder.paused ? 'bg-amber-400' : 'animate-pulse bg-red-500'
                }`}
              />
              <span className="font-mono text-sm tabular-nums text-white">
                {formatDuration(recorder.elapsedMs)}
              </span>
              {recorder.paused && (
                <span className="text-xs font-medium uppercase tracking-wide text-amber-300">
                  Paused
                </span>
              )}
            </div>
          )}
        </div>

          {dualExport && phase !== 'review' && (
            <div className="flex items-center gap-3 rounded-2xl border border-black/10 bg-black/[0.02] p-3">
              <canvas
                ref={portraitCanvasRef}
                width={PORTRAIT_DIMS.width}
                height={PORTRAIT_DIMS.height}
                className="h-40 w-auto shrink-0 rounded-lg bg-[#111]"
              />
              <div className="text-xs leading-relaxed text-black/55">
                <p className="font-medium text-black/70">Portrait cut</p>
                <p>
                  Auto-created alongside the landscape recording. You&apos;ll download both when
                  you stop.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="cb-card space-y-5 rounded-2xl border border-black/10 p-5">
          {!cameraOnly && phase !== 'review' && (
            <LayoutSwitcher layout={config.layout} onSelect={setLayout} />
          )}

          {!cameraOnly && phase === 'setup' && pipSupported && (
            <div className="space-y-2">
              <button type="button" onClick={togglePip} className={`w-full ${LIGHT_BTN}`}>
                <PictureInPicture2 className="h-4 w-4" />
                {pipWindow ? 'Close floating self-view' : 'Float self-view'}
              </button>
              <p className="text-[0.65rem] leading-relaxed text-black/40">
                Closes before recording so it is not captured in the final video.
              </p>
            </div>
          )}

          {phase === 'setup' && (
            <SetupControls
              cameras={cameras}
              mics={mics}
              selectedCamera={cameraValue}
              selectedMic={micValue}
              systemAudio={systemAudio}
              screenShared={!!screenStream}
              canRecord={canRecord}
              cameraOnly={cameraOnly}
              makePortrait={makePortrait}
              counting={countdown !== null}
              onCameraChange={(id) => {
                setSelectedCamera(id);
                void startCamMic(id, selectedMic || undefined);
              }}
              onMicChange={(id) => {
                setSelectedMic(id);
                void startCamMic(selectedCamera || undefined, id);
              }}
              onToggleSystemAudio={() => setSystemAudio((v) => !v)}
              onTogglePortrait={() => setMakePortrait((v) => !v)}
              onShareScreen={handleShareScreen}
              onFlipCamera={flipCamera}
              onRecord={beginCountdown}
            />
          )}

          {phase === 'recording' && (
            <div className="space-y-4">
              <p className="text-[0.65rem] font-medium uppercase tracking-[0.2em] text-black/40">
                Recording
              </p>
              <p className="text-sm text-black/60">
                {cameraOnly
                  ? 'Camera only — portrait. Mic audio is being captured.'
                  : dualExport
                    ? 'Screen with camera bubble, plus a portrait cut. Mic audio is being captured.'
                    : 'Screen with camera bubble. Mic audio is being captured.'}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {recorder.paused ? (
                  <button type="button" onClick={resumeRecording} className={LIGHT_BTN}>
                    <Play className="h-4 w-4" fill="currentColor" /> Resume
                  </button>
                ) : (
                  <button type="button" onClick={pauseRecording} className={LIGHT_BTN}>
                    <Pause className="h-4 w-4" fill="currentColor" /> Pause
                  </button>
                )}
                <button type="button" onClick={stopRecording} className={DARK_BTN}>
                  <Square className="h-4 w-4" fill="currentColor" /> Stop
                </button>
              </div>
            </div>
          )}

          {phase === 'review' && recorder.result && (
            <ReviewControls
              durationMs={recorder.elapsedMs}
              primaryLabel={cameraOnly ? 'Video' : 'Landscape'}
              primarySizeBytes={recorder.result.blob.size}
              onDownloadPrimary={() =>
                downloadBlob(recorder.result!.url, cameraOnly ? 'portrait' : 'landscape')
              }
              portraitSizeBytes={portraitRecorder.result?.blob.size ?? null}
              onDownloadPortrait={
                portraitRecorder.result
                  ? () => downloadBlob(portraitRecorder.result!.url, 'portrait')
                  : null
              }
              onRecordAgain={returnToSetup}
              onDiscard={returnToSetup}
            />
          )}
        </div>
      </div>

      {phase === 'review' && recorder.result && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className={`overflow-hidden rounded-2xl bg-black ${isPortrait ? 'flex justify-center' : ''}`}>
            <video
              src={recorder.result.url}
              controls
              playsInline
              className={`block ${isPortrait ? 'aspect-[9/16] h-[68vh] max-w-full' : 'aspect-video w-full'}`}
            />
          </div>
          <div className="space-y-4 self-start">
            {portraitRecorder.result && (
              <div className="flex justify-center overflow-hidden rounded-2xl bg-black">
                <video
                  src={portraitRecorder.result.url}
                  controls
                  playsInline
                  className="block aspect-[9/16] max-h-[70vh] max-w-full"
                />
              </div>
            )}
            <p className="rounded-xl border border-black/10 bg-black/[0.02] p-4 text-xs leading-relaxed text-black/55">
              {portraitRecorder.result
                ? 'Two WebM files — landscape and portrait. Convert to MP4 for LinkedIn with CapCut or ffmpeg.'
                : 'WebM downloads. Convert to MP4 for LinkedIn with CapCut or ffmpeg.'}
            </p>
          </div>
        </div>
      )}

      {pipWindow &&
        phase === 'setup' &&
        createPortal(
          <SelfViewPip
            cameraStream={camMicStream}
            layout={config.layout}
            recording={false}
            paused={false}
            elapsedLabel="00:00"
            canFlip={cameras.length >= 2}
            onLayout={setLayout}
            onFlip={flipCamera}
            onStop={stopRecording}
          />,
          pipWindow.document.body,
        )}
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3">
      <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
      <p className="flex-1 text-sm text-red-800">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="px-3 py-1.5 text-xs font-medium text-red-700 underline underline-offset-2 hover:text-red-900"
      >
        Retry
      </button>
    </div>
  );
}

function LayoutSwitcher({ layout, onSelect }: { layout: LayoutId; onSelect: (id: LayoutId) => void }) {
  const ids: LayoutId[] = [1, 2, 3];
  return (
    <div className="space-y-2">
      <p className="text-[0.65rem] font-medium uppercase tracking-[0.2em] text-black/40">Layout</p>
      <div className="grid grid-cols-3 gap-1.5">
        {ids.map((n) => {
          const active = layout === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onSelect(n)}
              aria-pressed={active}
              className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[0.7rem] transition-colors ${
                active
                  ? 'border-black bg-[#080808] text-white'
                  : 'border-black/10 text-black/60 hover:bg-black/5'
              }`}
            >
              <span className="font-mono text-sm">{n}</span>
              <span>{LAYOUT_META[n].label}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[0.65rem] leading-relaxed text-black/40">
        1 / 2 / 3 switch · Space cycles · Esc stops
      </p>
    </div>
  );
}

interface SetupControlsProps {
  cameras: { deviceId: string; label: string }[];
  mics: { deviceId: string; label: string }[];
  selectedCamera: string;
  selectedMic: string;
  systemAudio: boolean;
  screenShared: boolean;
  canRecord: boolean;
  cameraOnly: boolean;
  makePortrait: boolean;
  counting: boolean;
  onCameraChange: (id: string) => void;
  onMicChange: (id: string) => void;
  onToggleSystemAudio: () => void;
  onTogglePortrait: () => void;
  onShareScreen: () => void;
  onFlipCamera: () => void;
  onRecord: () => void;
}

function SetupControls({
  cameras,
  mics,
  selectedCamera,
  selectedMic,
  systemAudio,
  screenShared,
  canRecord,
  cameraOnly,
  makePortrait,
  counting,
  onCameraChange,
  onMicChange,
  onToggleSystemAudio,
  onTogglePortrait,
  onShareScreen,
  onFlipCamera,
  onRecord,
}: SetupControlsProps) {
  const micSelect = (
    <label className="block space-y-1.5">
      <span className="flex items-center gap-1.5 text-xs font-medium text-black/60">
        <Mic className="h-3.5 w-3.5" /> Microphone
      </span>
      <select
        value={selectedMic}
        onChange={(e) => onMicChange(e.target.value)}
        className="w-full border border-black/10 px-3 py-2.5 text-sm"
      >
        {mics.length === 0 && <option value="">Detecting…</option>}
        {mics.map((m) => (
          <option key={m.deviceId} value={m.deviceId}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );

  if (cameraOnly) {
    return (
      <div className="space-y-5">
        <p className="text-[0.65rem] font-medium uppercase tracking-[0.2em] text-black/40">Setup</p>

        {cameras.length >= 2 ? (
          <button type="button" onClick={onFlipCamera} className={`w-full ${LIGHT_BTN}`}>
            <SwitchCamera className="h-4 w-4" /> Flip camera
          </button>
        ) : (
          <label className="block space-y-1.5">
            <span className="flex items-center gap-1.5 text-xs font-medium text-black/60">
              <Camera className="h-3.5 w-3.5" /> Camera
            </span>
            <select
              value={selectedCamera}
              onChange={(e) => onCameraChange(e.target.value)}
              className="w-full border border-black/10 px-3 py-2.5 text-sm"
            >
              {cameras.length === 0 && <option value="">Detecting…</option>}
              {cameras.map((c) => (
                <option key={c.deviceId} value={c.deviceId}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {micSelect}

        <div className="border-t border-black/10 pt-4">
          <button
            type="button"
            onClick={onRecord}
            disabled={!canRecord || counting}
            className="inline-flex w-full items-center justify-center gap-2 bg-[#dc2626] px-4 py-3.5 text-sm font-medium text-white transition-colors hover:bg-[#b91c1c] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Circle className="h-4 w-4" fill="currentColor" />
            {counting ? 'Starting…' : 'Start recording'}
          </button>
          {!canRecord && (
            <p className="mt-2 text-center text-xs text-black/45">Waiting for camera…</p>
          )}
        </div>

        <p className="rounded-xl border border-black/10 bg-black/[0.02] p-3 text-xs leading-relaxed text-black/50">
          Screen recording isn&apos;t available in phone browsers. For screen + camera, open
          Studio on a laptop.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-[0.65rem] font-medium uppercase tracking-[0.2em] text-black/40">Setup</p>

      <label className="block space-y-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-black/60">
          <Camera className="h-3.5 w-3.5" /> Camera
        </span>
        <select
          value={selectedCamera}
          onChange={(e) => onCameraChange(e.target.value)}
          className="w-full border border-black/10 px-3 py-2 text-sm"
        >
          {cameras.length === 0 && <option value="">Detecting…</option>}
          {cameras.map((c) => (
            <option key={c.deviceId} value={c.deviceId}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      {micSelect}

      <button
        type="button"
        onClick={onToggleSystemAudio}
        className="flex w-full items-center justify-between border border-black/10 px-3 py-2.5 text-sm text-black/70 hover:bg-black/5"
      >
        <span className="flex items-center gap-2">
          {systemAudio ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          System audio
        </span>
        <span
          className={`text-xs font-medium ${systemAudio ? 'text-emerald-600' : 'text-black/40'}`}
        >
          {systemAudio ? 'On' : 'Off'}
        </span>
      </button>

      <button
        type="button"
        onClick={onTogglePortrait}
        className="flex w-full items-center justify-between border border-black/10 px-3 py-2.5 text-sm text-black/70 hover:bg-black/5"
      >
        <span className="flex items-center gap-2">
          <Smartphone className="h-4 w-4" />
          Portrait cut
        </span>
        <span
          className={`text-xs font-medium ${makePortrait ? 'text-emerald-600' : 'text-black/40'}`}
        >
          {makePortrait ? 'On' : 'Off'}
        </span>
      </button>

      <button
        type="button"
        onClick={onShareScreen}
        className={`w-full ${screenShared ? LIGHT_BTN : DARK_BTN}`}
      >
        <Monitor className="h-4 w-4" />
        {screenShared ? 'Re-share screen' : 'Share screen'}
      </button>
      <p className="-mt-2 text-[0.65rem] leading-relaxed text-black/40">
        Choose <span className="font-medium text-black/55">Entire Screen</span> in the picker to
        capture other tabs and apps — sharing a single tab records only that tab.
      </p>

      <div className="border-t border-black/10 pt-4">
        <button
          type="button"
          onClick={onRecord}
          disabled={!canRecord || counting}
          className="inline-flex w-full items-center justify-center gap-2 bg-[#dc2626] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#b91c1c] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Circle className="h-4 w-4" fill="currentColor" />
          {counting ? 'Starting…' : 'Start recording'}
        </button>
        {!canRecord && (
          <p className="mt-2 text-center text-xs text-black/45">
            {screenShared ? 'Waiting for camera…' : 'Share your screen to start.'}
          </p>
        )}
      </div>
    </div>
  );
}

interface ReviewControlsProps {
  durationMs: number;
  primaryLabel: string;
  primarySizeBytes: number;
  onDownloadPrimary: () => void;
  portraitSizeBytes: number | null;
  onDownloadPortrait: (() => void) | null;
  onRecordAgain: () => void;
  onDiscard: () => void;
}

function ReviewControls({
  durationMs,
  primaryLabel,
  primarySizeBytes,
  onDownloadPrimary,
  portraitSizeBytes,
  onDownloadPortrait,
  onRecordAgain,
  onDiscard,
}: ReviewControlsProps) {
  const hasPortrait = !!onDownloadPortrait;
  return (
    <div className="space-y-5">
      <p className="text-[0.65rem] font-medium uppercase tracking-[0.2em] text-black/40">Review</p>

      <div className="flex gap-6 text-sm">
        <div>
          <p className="font-mono tabular-nums text-black">{formatDuration(durationMs)}</p>
          <p className="text-xs text-black/45">Duration</p>
        </div>
        <div>
          <p className="font-mono tabular-nums text-black">
            {formatBytes(primarySizeBytes + (portraitSizeBytes ?? 0))}
          </p>
          <p className="text-xs text-black/45">{hasPortrait ? 'Total size' : 'Size'}</p>
        </div>
      </div>

      <button type="button" onClick={onDownloadPrimary} className={`w-full ${DARK_BTN}`}>
        <Download className="h-4 w-4" /> Download {hasPortrait ? primaryLabel.toLowerCase() : ''}
      </button>
      {hasPortrait && onDownloadPortrait && (
        <button type="button" onClick={onDownloadPortrait} className={`w-full ${LIGHT_BTN}`}>
          <Smartphone className="h-4 w-4" /> Download portrait
        </button>
      )}
      <button type="button" onClick={onRecordAgain} className={`w-full ${LIGHT_BTN}`}>
        <RotateCcw className="h-4 w-4" /> Record again
      </button>
      <button
        type="button"
        onClick={onDiscard}
        className="inline-flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm text-black/50 hover:text-black/80"
      >
        <Trash2 className="h-4 w-4" /> Discard
      </button>
    </div>
  );
}
