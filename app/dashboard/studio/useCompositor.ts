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

/**
 * Runs the draw loop that composites screen + camera onto the canvas every
 * frame. Reads config through a ref so layout / bubble changes take effect
 * instantly without restarting the loop. When a portrait canvas is supplied and
 * active, it is painted the same frame so both the landscape and portrait
 * recordings stay in sync.
 *
 * The loop is driven by a Web Worker tick, not requestAnimationFrame: rAF is
 * throttled to ~1fps on a hidden tab, which froze the recording the instant the
 * user switched to another tab/app. A worker setInterval keeps ticking at 30fps
 * in the background; the main thread renders on each tick. rAF is kept only as a
 * fallback if the worker can't be created.
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
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const render = () => {
      drawLayout(
        ctx,
        { width: canvas.width, height: canvas.height },
        configRef.current,
        screenVideoRef.current,
        cameraVideoRef.current,
      );

      const pCanvas = portraitActive ? portraitCanvasRef?.current : null;
      const pCtx = pCanvas?.getContext('2d');
      if (pCanvas && pCtx) {
        drawPortraitStacked(
          pCtx,
          { width: pCanvas.width, height: pCanvas.height },
          screenVideoRef.current,
          cameraVideoRef.current,
        );
      }
    };

    let raf = 0;
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('./tick.worker.ts', import.meta.url));
      worker.onmessage = render;
      worker.postMessage({ type: 'start', fps: FPS });
    } catch {
      // No Web Worker (or blocked): fall back to rAF. Still smooth while the tab
      // is visible; only the background-tab case degrades to what it was before.
      const loop = () => {
        render();
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
    };
  }, [active, canvasRef, screenVideoRef, cameraVideoRef, configRef, portraitCanvasRef, portraitActive]);
}
