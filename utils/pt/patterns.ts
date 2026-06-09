// Movement-pattern tags for programme exercises.
// Single source of truth: the canonical list, the chip colours, and the
// mapping from the exercise library's slug tags (see Cerebro Knowledge/
// exercise-library.md) to these display labels.

export const MOVEMENT_PATTERNS = [
  'Upper Pull',
  'Upper Pull (Single Arm)',
  'Upper Push',
  'Upper Push (Single Arm)',
  'Hinge',
  'Hinge (Single Leg)',
  'Legs Anterior',
  'Legs Anterior (Single Leg)',
  'Legs Posterior',
  'Legs Posterior (Single Leg)',
  'Core',
  'Core (Anti-Rotation)',
  'Carry',
  'Mobility',
  'Full Body / Power',
] as const;

export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];

// Static Tailwind classes (full strings so they survive the JIT purge).
// Grouped by family so single-arm/leg variants share their parent's colour.
export const PATTERN_CHIP: Record<string, string> = {
  'Upper Pull': 'bg-blue-100 text-blue-700 ring-blue-200',
  'Upper Pull (Single Arm)': 'bg-blue-100 text-blue-700 ring-blue-200',
  'Upper Push': 'bg-sky-100 text-sky-700 ring-sky-200',
  'Upper Push (Single Arm)': 'bg-sky-100 text-sky-700 ring-sky-200',
  'Hinge': 'bg-amber-100 text-amber-800 ring-amber-200',
  'Hinge (Single Leg)': 'bg-amber-100 text-amber-800 ring-amber-200',
  'Legs Anterior': 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  'Legs Anterior (Single Leg)': 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  'Legs Posterior': 'bg-teal-100 text-teal-700 ring-teal-200',
  'Legs Posterior (Single Leg)': 'bg-teal-100 text-teal-700 ring-teal-200',
  'Core': 'bg-violet-100 text-violet-700 ring-violet-200',
  'Core (Anti-Rotation)': 'bg-violet-100 text-violet-700 ring-violet-200',
  'Carry': 'bg-stone-200 text-stone-700 ring-stone-300',
  'Mobility': 'bg-rose-100 text-rose-700 ring-rose-200',
  'Full Body / Power': 'bg-fuchsia-100 text-fuchsia-700 ring-fuchsia-200',
};

const DEFAULT_CHIP = 'bg-black/[0.06] text-black/55 ring-black/10';

export function patternChipClass(pattern: string | null | undefined): string {
  if (!pattern) return DEFAULT_CHIP;
  return PATTERN_CHIP[pattern] ?? DEFAULT_CHIP;
}

// Library slug tags -> canonical pattern label.
// Slugs reflect what the exercise library / codex writes into pt_exercises.tags.
const TAG_TO_PATTERN: Record<string, string> = {
  'upper-pull': 'Upper Pull',
  'upper-pull-single-arm': 'Upper Pull (Single Arm)',
  'upper-push': 'Upper Push',
  'upper-push-single-arm': 'Upper Push (Single Arm)',
  'hinge': 'Hinge',
  'hinge-single-leg': 'Hinge (Single Leg)',
  'squat': 'Legs Anterior',
  'squat-single-leg-unilateral': 'Legs Anterior (Single Leg)',
  'posterior chain': 'Legs Posterior',
  'posterior-chain': 'Legs Posterior',
  'core': 'Core',
  'core-single-arm-anti-rotation': 'Core (Anti-Rotation)',
  'carry': 'Carry',
  'loaded-carry': 'Carry',
  'mobility': 'Mobility',
  'full-body': 'Full Body / Power',
  'power': 'Full Body / Power',
};

// Most specific first so a single-arm/leg variant wins over its bilateral parent.
const MATCH_PRIORITY = [
  'upper-pull-single-arm',
  'upper-push-single-arm',
  'squat-single-leg-unilateral',
  'hinge-single-leg',
  'core-single-arm-anti-rotation',
  'upper-pull',
  'upper-push',
  'hinge',
  'squat',
  'posterior chain',
  'posterior-chain',
  'core',
  'carry',
  'loaded-carry',
  'power',
  'full-body',
  'mobility',
];

// Derive the canonical movement pattern for a library exercise from its tags.
export function patternFromTags(tags: string[] | null | undefined): string | null {
  if (!tags || tags.length === 0) return null;
  const norm = tags.map((t) => t.toLowerCase().trim());
  for (const key of MATCH_PRIORITY) {
    if (norm.includes(key)) return TAG_TO_PATTERN[key];
  }
  return null;
}
