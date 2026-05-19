import type { PTProgrammeWeekBlock } from './types';

export type PhaseKind = 'foundation' | 'hypertrophy' | 'strength';

interface CanonicalBlock {
  sets: string;
  weight_pct?: string;
  weeks: number;
}

const CANONICAL: Record<PhaseKind, CanonicalBlock[]> = {
  foundation: [
    { sets: '2', weeks: 2 },
    { sets: '3', weeks: 3 },
    { sets: '3', weeks: 2 },
  ],
  hypertrophy: [
    { sets: '3', weight_pct: '65%', weeks: 3 },
    { sets: '4', weight_pct: '68%', weeks: 3 },
    { sets: '4', weight_pct: '72%', weeks: 3 },
    { sets: '5', weight_pct: '75%', weeks: 3 },
  ],
  strength: [
    { sets: '4', weight_pct: '77%', weeks: 2 },
    { sets: '4', weight_pct: '80%', weeks: 3 },
    { sets: '5', weight_pct: '85%', weeks: 3 },
    { sets: '6', weight_pct: '88%', weeks: 2 },
  ],
};

const CANONICAL_TOTAL: Record<PhaseKind, number> = {
  foundation: 7,
  hypertrophy: 12,
  strength: 10,
};

export function scaleWeekBlocks(kind: PhaseKind, targetWeeks: number): PTProgrammeWeekBlock[] {
  const target = Math.max(1, Math.round(targetWeeks));
  const canonical = CANONICAL[kind];
  const canonicalTotal = CANONICAL_TOTAL[kind];

  if (target === canonicalTotal) {
    return canonical.map((b) => ({ ...b }));
  }

  const ratios = canonical.map((b) => b.weeks / canonicalTotal);
  let allocations = ratios.map((r) => Math.max(1, Math.round(r * target)));
  let diff = allocations.reduce((a, b) => a + b, 0) - target;

  while (diff > 0) {
    const idx = allocations.reduce((best, w, i) => (w > allocations[best] ? i : best), 0);
    if (allocations[idx] <= 1) break;
    allocations[idx] -= 1;
    diff -= 1;
  }
  while (diff < 0) {
    const idx = allocations.reduce((best, w, i) => (w < allocations[best] ? i : best), 0);
    allocations[idx] += 1;
    diff += 1;
  }

  if (target < canonical.length) {
    const trimmed: CanonicalBlock[] = [];
    const trimmedAllocations: number[] = [];
    for (let i = 0; i < canonical.length && trimmed.length < target; i++) {
      trimmed.push(canonical[i]);
      trimmedAllocations.push(1);
    }
    return trimmed.map((b, i) => ({ sets: b.sets, weight_pct: b.weight_pct, weeks: trimmedAllocations[i] }));
  }

  return canonical
    .map((b, i) => ({ sets: b.sets, weight_pct: b.weight_pct, weeks: allocations[i] }))
    .filter((b) => b.weeks > 0);
}

export const FOUNDATION_DAY_COUNT = 3;
export const ONE_RM_TEST_SETS = '5';
export const BIG_5_NAMES = [
  'BB Squat',
  'BB Deadlift',
  'BB Bench Press',
  'BB Shoulder Press',
  'Pull-up',
] as const;

export type Big5Name = (typeof BIG_5_NAMES)[number];

export interface FoundationSubstitutionRule {
  from_week: number;
  swaps: { from_pattern: string; to: Big5Name }[];
}

export function getFoundationSubstitutionRule(weekBlocks: PTProgrammeWeekBlock[]): FoundationSubstitutionRule {
  const totalWeeks = weekBlocks.reduce((sum, b) => sum + (b.weeks || 0), 0);
  return {
    from_week: Math.max(1, totalWeeks - 1),
    swaps: [
      { from_pattern: 'goblet squat', to: 'BB Squat' },
      { from_pattern: 'kb deadlift|db deadlift|dumbbell deadlift|kettlebell deadlift', to: 'BB Deadlift' },
      { from_pattern: 'db bench|dumbbell bench', to: 'BB Bench Press' },
      { from_pattern: 'lat pull[- ]?down', to: 'Pull-up' },
      { from_pattern: 'db shoulder press|dumbbell shoulder press', to: 'BB Shoulder Press' },
    ],
  };
}
