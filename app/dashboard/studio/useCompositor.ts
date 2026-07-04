'use client';

import { useEffect, type RefObject } from 'react';
import { drawLayout } from './layouts';
import type { CompositorConfig } from './types';

interface UseCompositorParams {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  screenVideoRef: RefObject<HTMLVideoElement | null>;
  cameraVideoRef: RefObject<HTMLVideoElement | null>;
  configRef: RefObject<CompositorConfig>;
  active: boolean;
}

/**
 * Runs the requestAnimationFrame draw loop that composites screen + camera
 * onto the canvas every frame. Reads config through a ref so layout / bubble
 * changes take effect instantly without restarting the loop.
 */
export function useCompositor({
  canvasRef,
  screenVideoRef,
  cameraVideoRef,
  configRef,
  active,
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
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, canvasRef, screenVideoRef, cameraVideoRef, configRef]);
}
