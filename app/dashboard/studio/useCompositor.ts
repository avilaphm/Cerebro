'use client';

import { useEffect, type RefObject } from 'react';
import { drawLayout, drawPortraitStacked } from './layouts';
import type { CompositorConfig } from './types';

interface UseCompositorParams {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  screenVideoRef: RefObject<HTMLVideoElement | null>;
  cameraVideoRef: RefObject<HTMLVideoElement | null>;
  configRef: RefObject<CompositorConfig>;
  active: boolean;
  // Optional second canvas that receives the portrait (9:16) screen+face
  // composition each frame, for the simultaneous vertical export.
  portraitCanvasRef?: RefObject<HTMLCanvasElement | null>;
  portraitActive?: boolean;
}

const FPS = 30;
const MIN_RENDER_INTERVAL_MS = 1000 / FPS - 2;
const WORKER_STALL_HEARTBEAT_MS = (1000 / FPS) * 2.5;
const PERF_LOG_INTERVAL_MS = 5000;
const CANVAS_CONTEXT_OPTIONS: CanvasRenderingContext2DSettings = {
  alpha: false,
  desynchronized: true,
};

type RenderSource = 'initial' | 'worker' | 'camera-frame' | 'screen-frame' | 'fallback-raf';

interface PerfCounters {
  draws: number;
  skipped: number;
  workerTicks: number;
  cameraFrames: number;
  screenFrames: number;
  lastCameraPresentedFrames: number;
  lastScreenPresentedFrames: number;
  lastLogAt: number;
}

function get2dContext(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  return canvas?.getContext('2d', CANVAS_CONTEXT_OPTIONS) ?? null;
}

function countPresentedFrame(
  counters: PerfCounters,
  source: Extract<RenderSource, 'camera-frame' | 'screen-frame'>,
  metadata: VideoFrameCallbackMetadata,
) {
  const presented = metadata.presentedFrames;
  if (source === 'camera-frame') {
    const previous = counters.lastCameraPresentedFrames;
    counters.cameraFrames += previous > 0 && presented > previous ? presented - previous : 1;
    counters.lastCameraPresentedFrames = presented;
  } else {
    const previous = counters.lastScreenPresentedFrames;
    counters.screenFrames += previous > 0 && presented > previous ? presented - previous : 1;
    counters.lastScreenPresentedFrames = presented;
  }
}

function scheduleVideoFrameLoop(
  video: HTMLVideoElement | null,
  source: Extract<RenderSource, 'camera-frame' | 'screen-frame'>,
  counters: PerfCounters,
  render: (source: RenderSource) => void,
): () => void {
  if (!video || typeof video.requestVideoFrameCallback !== 'function') return () => {};

  let cancelled = false;
  let requestId = 0;

  const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
    if (cancelled) return;
    countPresentedFrame(counters, source, metadata);
    render(source);
    requestId = video.requestVideoFrameCallback(onFrame);
  };

  requestId = video.requestVideoFrameCallback(onFrame);

  return () => {
    cancelled = true;
    if (typeof video.cancelVideoFrameCallback === 'function') {
      video.cancelVideoFrameCallback(requestId);
    }
  };
}

/**
 * Runs the draw loop that composites screen + camera onto the canvas every
 * frame. Reads config through a ref so layout / bubble changes take effect
 * instantly without restarting the loop. When a portrait canvas is supplied and
 * active, it is painted the same frame so both the landscape and portrait
 * recordings stay in sync.
 *
 * Video frame callbacks drive normal rendering so the camera/screen are drawn
 * when the browser delivers a real media frame. A worker tick stays alive as a
 * stall watchdog because requestAnimationFrame is throttled to ~1fps on a hidden
 * tab, which froze the recording the instant the user switched to another
 * tab/app. rAF is kept only as a fallback if the worker can't be created.
 */
export function useCompositor({
  canvasRef,
  screenVideoRef,
  cameraVideoRef,
  configRef,
  active,
  portraitCanvasRef,
  portraitActive,
}: UseCompositorParams) {
  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    const ctx = get2dContext(canvas);
    if (!canvas || !ctx) return;
    const counters: PerfCounters = {
      draws: 0,
      skipped: 0,
      workerTicks: 0,
      cameraFrames: 0,
      screenFrames: 0,
      lastCameraPresentedFrames: 0,
      lastScreenPresentedFrames: 0,
      lastLogAt: performance.now(),
    };

    let lastRenderAt = 0;

    const maybeLogPerf = (now: number, source: RenderSource) => {
      const elapsedSeconds = (now - counters.lastLogAt) / 1000;
      if (elapsedSeconds < PERF_LOG_INTERVAL_MS / 1000) return;

      console.info('[Studio compositor]', {
        source,
        canvas: `${canvas.width}x${canvas.height}`,
        portrait: portraitActive
          ? `${portraitCanvasRef?.current?.width ?? 0}x${portraitCanvasRef?.current?.height ?? 0}`
          : 'off',
        hidden: document.hidden,
        drawFps: Number((counters.draws / elapsedSeconds).toFixed(1)),
        cameraFrameFps: Number((counters.cameraFrames / elapsedSeconds).toFixed(1)),
        screenFrameFps: Number((counters.screenFrames / elapsedSeconds).toFixed(1)),
        workerTickFps: Number((counters.workerTicks / elapsedSeconds).toFixed(1)),
        skippedDraws: counters.skipped,
      });

      counters.draws = 0;
      counters.skipped = 0;
      counters.workerTicks = 0;
      counters.cameraFrames = 0;
      counters.screenFrames = 0;
      counters.lastLogAt = now;
    };

    const render = (source: RenderSource) => {
      const now = performance.now();
      if (source !== 'initial' && now - lastRenderAt < MIN_RENDER_INTERVAL_MS) {
        counters.skipped += 1;
        return;
      }
      lastRenderAt = now;
      counters.draws += 1;

      drawLayout(
        ctx,
        { width: canvas.width, height: canvas.height },
        configRef.current,
        screenVideoRef.current,
        cameraVideoRef.current,
      );

      const pCanvas = portraitActive ? portraitCanvasRef?.current : null;
      const pCtx = get2dContext(pCanvas ?? null);
      if (pCanvas && pCtx) {
        drawPortraitStacked(
          pCtx,
          { width: pCanvas.width, height: pCanvas.height },
          screenVideoRef.current,
          cameraVideoRef.current,
        );
      }

      maybeLogPerf(now, source);
    };

    let raf = 0;
    let worker: Worker | null = null;
    render('initial');
    const hasVideoFrameClock =
      typeof cameraVideoRef.current?.requestVideoFrameCallback === 'function' ||
      typeof screenVideoRef.current?.requestVideoFrameCallback === 'function';
    const cancelCameraFrameLoop = scheduleVideoFrameLoop(
      cameraVideoRef.current,
      'camera-frame',
      counters,
      render,
    );
    const cancelScreenFrameLoop = scheduleVideoFrameLoop(
      screenVideoRef.current,
      'screen-frame',
      counters,
      render,
    );

    try {
      worker = new Worker(new URL('./tick.worker.ts', import.meta.url));
      worker.onmessage = () => {
        counters.workerTicks += 1;
        const videoClockIsFresh = performance.now() - lastRenderAt < WORKER_STALL_HEARTBEAT_MS;
        if (hasVideoFrameClock && videoClockIsFresh) {
          return;
        }
        render('worker');
      };
      worker.postMessage({ type: 'start', fps: FPS });
    } catch {
      // No Web Worker (or blocked): fall back to rAF. Still smooth while the tab
      // is visible; only the background-tab case degrades to what it was before.
      const loop = () => {
        render('fallback-raf');
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    return () => {
      if (worker) {
        worker.postMessage({ type: 'stop' });
        worker.terminate();
      }
      if (raf) cancelAnimationFrame(raf);
      cancelCameraFrameLoop();
      cancelScreenFrameLoop();
    };
  }, [active, canvasRef, screenVideoRef, cameraVideoRef, configRef, portraitCanvasRef, portraitActive]);
}
