import type { PTProgrammeWeekBlock } from './types';

export type PhaseKind = 'foundation' | 'hypertrophy' | 'strength';

interface CanonicalBlock {
  sets: string;
  weight_pct?: string;
  weeks: number;
}

// Foundation phase: linear set progression, no deload (the whole phase is the
// onramp, deload would be redundant). Default 7 weeks = 2 + 3 + 2.
const FOUNDATION_CANONICAL: CanonicalBlock[] = [
  { sets: '2', weeks: 2 },
  { sets: '3', weeks: 3 },
  { sets: '3', weeks: 2 },
];
const FOUNDATION_TOTAL = 7;

// Hypertrophy and Strength follow Eric Helms (Muscle & Strength Training
// Pyramid, 2nd ed): mesocycles of 4 weeks (3 build + 1 deload). Helms
// explicitly recommends a deload every 3rd meso minimum; running one every
// meso is safer for the Cerebro client profile (general population, returning
// lifters, sleep-disrupted parents, etc).
//
// Compound %1RM is a floor/ceiling guide within the hypertrophy/strength
// zone. RPE / proximity to failure drives day-to-day load (Helms 2nd ed:
// "intensity is primarily guided by repetition range and proximity to
// failure, rather than by a percentage of 1RM").
//
// Default cadence (target = canonical total): 12-week hypertrophy = 3 mesos,
// 10-week strength = 2 mesos + 2-week peak. Each meso shape comes from
// `mesoTemplate(kind, mesoIndex)`. The scaler builds enough mesos to fill
// targetWeeks, then trims/extends the final meso to match exactly.

interface MesoBlock {
  label: 'build1' | 'build2' | 'peak' | 'deload';
  sets: string;
  weight_pct: string;
}

const HYPERTROPHY_MESOS: MesoBlock[][] = [
  [
    { label: 'build1', sets: '3', weight_pct: '65%' },
    { label: 'build2', sets: '4', weight_pct: '70%' },
    { label: 'peak', sets: '4', weight_pct: '75%' },
    { label: 'deload', sets: '2', weight_pct: '60%' },
  ],
  [
    { label: 'build1', sets: '4', weight_pct: '67.5%' },
    { label: 'build2', sets: '4', weight_pct: '72.5%' },
    { label: 'peak', sets: '5', weight_pct: '77.5%' },
    { label: 'deload', sets: '2', weight_pct: '62.5%' },
  ],
  [
    { label: 'build1', sets: '4', weight_pct: '70%' },
    { label: 'build2', sets: '5', weight_pct: '75%' },
    { label: 'peak', sets: '5', weight_pct: '80%' },
    { label: 'deload', sets: '3', weight_pct: '65%' },
  ],
];

const STRENGTH_MESOS: MesoBlock[][] = [
  [
    { label: 'build1', sets: '4', weight_pct: '77%' },
    { label: 'build2', sets: '4', weight_pct: '82%' },
    { label: 'peak', sets: '5', weight_pct: '87%' },
    { label: 'deload', sets: '2', weight_pct: '70%' },
  ],
  [
    { label: 'build1', sets: '5', weight_pct: '80%' },
    { label: 'build2', sets: '5', weight_pct: '85%' },
    { label: 'peak', sets: '6', weight_pct: '90%' },
    { label: 'deload', sets: '2', weight_pct: '72%' },
  ],
  [
    { label: 'build1', sets: '5', weight_pct: '82%' },
    { label: 'build2', sets: '6', weight_pct: '88%' },
    { label: 'peak', sets: '6', weight_pct: '92%' },
    { label: 'deload', sets: '3', weight_pct: '72%' },
  ],
];

export function scaleWeekBlocks(kind: PhaseKind, targetWeeks: number): PTProgrammeWeekBlock[] {
  const target = Math.max(1, Math.round(targetWeeks));
  if (kind === 'foundation') return scaleFoundation(target);
  const mesos = kind === 'hypertrophy' ? HYPERTROPHY_MESOS : STRENGTH_MESOS;
  return scaleMesoBased(mesos, target);
}

function scaleFoundation(target: number): PTProgrammeWeekBlock[] {
  if (target === FOUNDATION_TOTAL) return FOUNDATION_CANONICAL.map((b) => ({ ...b }));

  if (target < FOUNDATION_CANONICAL.length) {
    return FOUNDATION_CANONICAL.slice(0, target).map((b) => ({ ...b, weeks: 1 }));
  }

  const ratios = FOUNDATION_CANONICAL.map((b) => b.weeks / FOUNDATION_TOTAL);
  const alloc = ratios.map((r) => Math.max(1, Math.round(r * target)));
  let diff = alloc.reduce((a, b) => a + b, 0) - target;
  while (diff > 0) {
    const idx = alloc.reduce((best, w, i) => (w > alloc[best] ? i : best), 0);
    if (alloc[idx] <= 1) break;
    alloc[idx] -= 1; diff -= 1;
  }
  while (diff < 0) {
    const idx = alloc.reduce((best, w, i) => (w < alloc[best] ? i : best), 0);
    alloc[idx] += 1; diff += 1;
  }
  return FOUNDATION_CANONICAL.map((b, i) => ({ sets: b.sets, weeks: alloc[i] }));
}

function scaleMesoBased(mesos: MesoBlock[][], target: number): PTProgrammeWeekBlock[] {
  // Each full meso = 4 weeks. Build mesos until we hit/exceed target, then
  // trim the final meso to land exactly on target.
  const blocks: PTProgrammeWeekBlock[] = [];
  let weeksUsed = 0;
  let mesoIdx = 0;

  while (weeksUsed < target) {
    const meso = mesos[Math.min(mesoIdx, mesos.length - 1)];
    const remaining = target - weeksUsed;

    if (remaining >= 4) {
      // Full meso: 3 build + 1 deload
      for (const b of meso) {
        blocks.push({ sets: b.sets, weight_pct: b.weight_pct, weeks: 1 });
      }
      weeksUsed += 4;
    } else {
      // Partial final meso. Always end on a deload if we have at least 2 weeks
      // available; otherwise just emit build weeks.
      if (remaining === 1) {
        blocks.push({ sets: meso[0].sets, weight_pct: meso[0].weight_pct, weeks: 1 });
      } else if (remaining === 2) {
        blocks.push({ sets: meso[0].sets, weight_pct: meso[0].weight_pct, weeks: 1 });
        blocks.push({ sets: meso[3].sets, weight_pct: meso[3].weight_pct, weeks: 1 });
      } else { // remaining === 3
        blocks.push({ sets: meso[0].sets, weight_pct: meso[0].weight_pct, weeks: 1 });
        blocks.push({ sets: meso[1].sets, weight_pct: meso[1].weight_pct, weeks: 1 });
        blocks.push({ sets: meso[3].sets, weight_pct: meso[3].weight_pct, weeks: 1 });
      }
      weeksUsed = target;
    }
    mesoIdx += 1;
  }

  return blocks;
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
export type DaysPerWeek = 3 | 4 | 5;

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

// Big 5 distribution across days, by split type. Returns one array per day,
// each listing the Big 5 lifts that must appear at the top of that day's
// workout section. Accessory exercises are sprinkled after the Big 5.
export function big5ScheduleByDays(days: DaysPerWeek): Big5Name[][] {
  switch (days) {
    case 3:
      // 3 full-body days: all 5 Big 5 each day. Same workout shape repeated.
      return [
        ['BB Squat', 'BB Deadlift', 'BB Bench Press', 'BB Shoulder Press', 'Pull-up'],
        ['BB Squat', 'BB Deadlift', 'BB Bench Press', 'BB Shoulder Press', 'Pull-up'],
        ['BB Squat', 'BB Deadlift', 'BB Bench Press', 'BB Shoulder Press', 'Pull-up'],
      ];
    case 4:
      // Upper/Lower split. Each Big 5 lift trained 2x/week.
      return [
        ['BB Squat', 'BB Deadlift'],                     // Day 1 Lower A
        ['BB Bench Press', 'BB Shoulder Press', 'Pull-up'], // Day 2 Upper A
        ['BB Squat', 'BB Deadlift'],                     // Day 3 Lower B
        ['BB Bench Press', 'BB Shoulder Press', 'Pull-up'], // Day 4 Upper B
      ];
    case 5:
      // Push / Pull / Legs + Upper / Lower hybrid. Each Big 5 lift 2x/week.
      return [
        ['BB Squat'],                                    // Day 1 Lower A
        ['BB Bench Press', 'BB Shoulder Press'],         // Day 2 Push
        ['BB Deadlift', 'Pull-up'],                      // Day 3 Pull
        ['BB Squat'],                                    // Day 4 Lower B
        ['BB Bench Press', 'BB Shoulder Press', 'Pull-up'], // Day 5 Upper
      ];
  }
}

export function dayTitleByDays(days: DaysPerWeek, dayIndex: number, phaseLabel: string): string {
  const labels3 = ['Day 1 - Full Body A', 'Day 2 - Full Body B', 'Day 3 - Full Body C'];
  const labels4 = ['Day 1 - Lower A', 'Day 2 - Upper A', 'Day 3 - Lower B', 'Day 4 - Upper B'];
  const labels5 = ['Day 1 - Lower A', 'Day 2 - Push', 'Day 3 - Pull', 'Day 4 - Lower B', 'Day 5 - Upper'];
  const labels = days === 3 ? labels3 : days === 4 ? labels4 : labels5;
  const suffix = labels[dayIndex] ?? `Day ${dayIndex + 1}`;
  return phaseLabel ? `${suffix} (${phaseLabel})` : suffix;
}
