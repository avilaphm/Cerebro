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

// Best-effort movement pattern from the exercise NAME. Used because much of the
// library carries free-form legacy tags (e.g. "lower body", "pulling") rather
// than the clean pattern slugs, so the name is the more reliable signal.
export function patternFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.toLowerCase();
  const isSA = /(single[- ]?arm|one[- ]?arm|1[- ]?arm)/.test(n) || /\bsa\b/.test(n);
  const isSL = /(single[- ]?leg|one[- ]?leg|1[- ]?leg|bulgarian|split[- ]?squat|step[- ]?up|pistol|skater|cossack|shrimp|staggered|b[- ]?stance)/.test(n);

  if (/(stretch|mobility|cat[- ]?cow|\bcars\b|90\/?90|thoracic|airplane|opener|foam[- ]?roll|wall slide|dead[- ]?hang|breathing|clamshell|fire hydrant|activation march|hip switch)/.test(n)) return 'Mobility';
  if (/(loaded carry|\bcarry\b|farmer|suitcase carry|waiter walk|overhead walk)/.test(n)) return 'Carry';
  if (/(clean|snatch|\bjerk\b|thruster|burpee|\bpower\b)/.test(n)) return 'Full Body / Power';
  if (/(plank|crunch|dead[- ]?bug|sit[- ]?up|hollow|pallof|wood[- ]?chop|russian twist|bird[- ]?dog|ab wheel|rollout|leg raise|knee raise|hanging|toes to bar|side bend|anti[- ]?rotation|oblique|\bcore\b)/.test(n)) return isSA ? 'Core (Anti-Rotation)' : 'Core';
  if (/(deadlift|\brdl\b|romanian|good[- ]?morning|kettlebell swing|kb swing|\bswing\b|hip hinge|pull[- ]?through|hyperextension|back extension|45 extension)/.test(n)) return isSL ? 'Hinge (Single Leg)' : 'Hinge';
  if (/(hip thrust|glute bridge|\bglute\b|ham(string)?[- ]?curl|leg curl|nordic|hip extension|kickback|frog pump|reverse hyper)/.test(n)) return isSL ? 'Legs Posterior (Single Leg)' : 'Legs Posterior';
  if (/(squat|lunge|leg press|leg extension|hack|sissy|wall sit|goblet)/.test(n) || isSL) return isSL ? 'Legs Anterior (Single Leg)' : 'Legs Anterior';
  if (/(row|pull[- ]?down|pulldown|pull[- ]?up|pullup|chin[- ]?up|\bpull\b|\blat\b|face pull|rear delt|reverse fly|\bcurl\b|shrug|pullover|chin)/.test(n)) return isSA ? 'Upper Pull (Single Arm)' : 'Upper Pull';
  if (/(press|push[- ]?up|pushup|bench|\bfly\b|\bdip\b|tricep|push[- ]?down|overhead|lateral raise|front raise|\braise\b|shoulder|chest|skull[- ]?crusher|extension|\bohp\b)/.test(n)) return isSA ? 'Upper Push (Single Arm)' : 'Upper Push';
  return null;
}

// Combined auto-derivation for a new exercise added from the library: prefer the
// (reliable) name, fall back to slug tags.
export function derivePattern(name: string | null | undefined, tags: string[] | null | undefined): string | null {
  return patternFromName(name) ?? patternFromTags(tags);
}

type ResolvableExercise = { pattern?: string | null; exercise_id?: string | null; name?: string | null };

// Resolve the pattern to DISPLAY for a programme exercise: a hand-set pattern
// wins; otherwise derive from the name, then the linked library card's tags.
export function resolvePattern(
  ex: ResolvableExercise,
  libById?: Map<string, { name?: string | null; tags?: string[] | null }>,
): string | null {
  if (ex.pattern) return ex.pattern;
  const byName = patternFromName(ex.name);
  if (byName) return byName;
  const lib = ex.exercise_id && libById ? libById.get(ex.exercise_id) : undefined;
  return patternFromName(lib?.name) ?? patternFromTags(lib?.tags);
}
