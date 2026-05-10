import { STAGE1_QUARTERS, hasTag } from '@/utils/leads/tags';

// Four-quadrant pie indicator. Each wedge maps to one Stage 1 milestone,
// going clockwise from 12 o'clock: Fresh lead, Email 1, Email 2, Proposal viewed.
// Filled emerald when the milestone has fired, faint grey when still pending.

const WEDGES = [
  // top-right (12 → 3): Fresh lead
  'M 16 16 L 16 0 A 16 16 0 0 1 32 16 Z',
  // bottom-right (3 → 6): Email 1
  'M 16 16 L 32 16 A 16 16 0 0 1 16 32 Z',
  // bottom-left (6 → 9): Email 2
  'M 16 16 L 16 32 A 16 16 0 0 1 0 16 Z',
  // top-left (9 → 12): Proposal viewed
  'M 16 16 L 0 16 A 16 16 0 0 1 16 0 Z',
];

export default function QuadProgress({
  tags,
  size = 28,
}: {
  tags: readonly string[];
  size?: number;
}) {
  const completedCount = STAGE1_QUARTERS.filter((q) => hasTag(tags, q.key)).length;
  const labels = STAGE1_QUARTERS.map(
    (q) => `${q.label}: ${hasTag(tags, q.key) ? 'done' : 'pending'}`,
  ).join(', ');

  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role="img"
      aria-label={`Stage 1 progress: ${completedCount} of 4 — ${labels}`}
      className="flex-shrink-0"
    >
      {STAGE1_QUARTERS.map((q, i) => (
        <path
          key={q.key}
          d={WEDGES[i]}
          fill={hasTag(tags, q.key) ? '#10b981' : 'rgba(0,0,0,0.07)'}
          stroke="white"
          strokeWidth="0.8"
        />
      ))}
    </svg>
  );
}
