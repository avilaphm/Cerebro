import type { CanvasDims, CompositorConfig, Orientation, BubblePosition } from './types';

// Solid dark backdrop behind letterboxing / pillarboxing.
const STAGE_BG = '#111111';

// Camera bubble width as a fraction of canvas width, per orientation, before
// the size preset multiplier is applied.
const BUBBLE_BASE: Record<Orientation, number> = {
  landscape: 0.22,
  portrait: 0.35,
};

const BUBBLE_PRESET = {
  small: 0.72,
  medium: 1,
  large: 1.3,
} as const;

// Bubble inset from the canvas edge, as a fraction of canvas width.
const BUBBLE_MARGIN = 0.025;

function isReady(video: HTMLVideoElement | null): video is HTMLVideoElement {
  return !!video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
}

// object-fit: cover — fill the box, cropping the overflow, never distorting.
function drawCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  overscan = 1,
) {
  const { videoWidth: vw, videoHeight: vh } = video;
  const scale = Math.max(dw / vw, dh / vh) * overscan;
  const sw = dw / scale;
  const sh = dh / scale;
  ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, dx, dy, dw, dh);
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function bubbleRect(dims: CanvasDims, config: CompositorConfig) {
  const frac = BUBBLE_BASE[config.orientation] * BUBBLE_PRESET[config.bubbleSize];
  const w = dims.width * frac;
  const h = w * (9 / 16);
  const margin = dims.width * BUBBLE_MARGIN;
  const positions: Record<BubblePosition, { x: number; y: number }> = {
    'top-left': { x: margin, y: margin },
    'top-right': { x: dims.width - w - margin, y: margin },
    'bottom-left': { x: margin, y: dims.height - h - margin },
    'bottom-right': { x: dims.width - w - margin, y: dims.height - h - margin },
  };
  const { x, y } = positions[config.bubblePosition];
  return { x, y, w, h };
}

function drawBubble(
  ctx: CanvasRenderingContext2D,
  dims: CanvasDims,
  config: CompositorConfig,
  camera: HTMLVideoElement,
) {
  const { x, y, w, h } = bubbleRect(dims, config);
  const scale = dims.width / 1920;
  const radius = 16 * scale;

  // Soft drop shadow, cast by filling the rounded rect first.
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 28 * scale;
  ctx.shadowOffsetY = 10 * scale;
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = '#000000';
  ctx.fill();
  ctx.restore();

  // Clip to the rounded rect and cover-crop the camera into it.
  ctx.save();
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.clip();
  drawCover(ctx, camera, x, y, w, h);
  ctx.restore();
}

/**
 * Portrait (9:16) repurpose of a screen + camera recording for social video:
 * screen on the top half, speaker on the bottom half, both full-bleed. Used for
 * the second, vertical export that records alongside the landscape take. Pure
 * and defensive like drawLayout — missing sources are skipped.
 */
export function drawPortraitStacked(
  ctx: CanvasRenderingContext2D,
  dims: CanvasDims,
  screen: HTMLVideoElement | null,
  camera: HTMLVideoElement | null,
) {
  const { width: W, height: H } = dims;

  ctx.fillStyle = STAGE_BG;
  ctx.fillRect(0, 0, W, H);

  const screenH = Math.round(H * 0.5);
  const cameraH = H - screenH;

  if (isReady(screen)) drawCover(ctx, screen, 0, 0, W, screenH, 1.04);
  if (isReady(camera)) drawCover(ctx, camera, 0, screenH, W, cameraH);
}

/**
 * Draws the current layout onto the canvas for a single frame. Pure and
 * defensive: missing / not-yet-ready videos are simply skipped so the loop
 * never throws. The same canvas is both the on-screen preview and the
 * MediaRecorder source, so whatever is drawn here is exactly what records.
 */
export function drawLayout(
  ctx: CanvasRenderingContext2D,
  dims: CanvasDims,
  config: CompositorConfig,
  screen: HTMLVideoElement | null,
  camera: HTMLVideoElement | null,
) {
  ctx.fillStyle = STAGE_BG;
  ctx.fillRect(0, 0, dims.width, dims.height);

  // Layout 2 — camera fills the whole canvas (cover-cropped).
  if (config.layout === 2) {
    if (isReady(camera)) drawCover(ctx, camera, 0, 0, dims.width, dims.height);
    return;
  }

  // Layouts 1 and 3 — screen fills the whole canvas (cover-cropped) so there is
  // no black dead space. A 16:10 laptop display loses a few pixels top/bottom.
  if (isReady(screen)) drawCover(ctx, screen, 0, 0, dims.width, dims.height);

  if (config.layout === 3) return;

  // Layout 1 — camera bubble on top of the screen.
  if (isReady(camera)) drawBubble(ctx, dims, config, camera);
}
