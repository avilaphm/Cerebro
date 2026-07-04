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

/**
 * Runs the requestAnimationFrame draw loop that composites screen + camera
 * onto the canvas every frame. Reads config through a ref so layout / bubble
 * changes take effect instantly without restarting the loop. When a portrait
 * canvas is supplied and active, it is painted the same frame so both the
 * landscape and portrait recordings stay in sync.
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

    let raf = 0;
    const loop = () => {
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

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, canvasRef, screenVideoRef, cameraVideoRef, configRef, portraitCanvasRef, portraitActive]);
}
