export type LayoutId = 1 | 2 | 3;
export type Orientation = 'landscape' | 'portrait';
export type BubblePosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type BubbleSize = 'small' | 'medium' | 'large';

// Recorder lifecycle. 'processing' = raw take captured, compositing the
// landscape + portrait exports offline before review.
export type StudioPhase = 'setup' | 'recording' | 'processing' | 'review';

export interface CanvasDims {
  width: number;
  height: number;
}

export interface CompositorConfig {
  layout: LayoutId;
  orientation: Orientation;
  bubblePosition: BubblePosition;
  bubbleSize: BubbleSize;
}

export const ORIENTATION_DIMS: Record<Orientation, CanvasDims> = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
};

// Canvas has captureStream() but TS' dom lib omits it in this config.
export type CanvasWithCapture = HTMLCanvasElement & {
  captureStream: (frameRate?: number) => MediaStream;
};
