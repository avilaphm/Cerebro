import type { PTExercise, PTProgramme, PTProgrammeExercise, PTProgrammePhase, PTProgrammeWeekBlock, PTProgrammeExerciseBlockOverride } from './types';

export const emptyProgramme: PTProgramme = { phases: [] };

export const CANONICAL_SECTION_ORDER = ['Warm Up', 'Workout', 'MetCon', 'Stretches'] as const;

export const DEFAULT_PROGRAMME_PHASES: Omit<PTProgrammePhase, 'id'>[] = [
  { title: 'Phase 1 - Foundation', focus: 'Movement quality & base conditioning', weeks: '4', progression: '', days: [] },
  { title: 'Testing 1 RM', focus: 'Baseline strength assessment', weeks: '1', progression: '', days: [] },
  { title: 'Phase 2 - Hypertrophy', focus: 'Muscle building & volume', weeks: '4', progression: '', days: [] },
  { title: 'Phase 3 - Strength', focus: 'Maximal strength development', weeks: '4', progression: '', days: [] },
  { title: 'Re-testing 1 RM', focus: 'Strength reassessment', weeks: '1', progression: '', days: [] },
];

export function sortExercisesBySectionOrder(exercises: PTProgrammeExercise[]): PTProgrammeExercise[] {
  type Group = { name: string | null; items: PTProgrammeExercise[] };
  const groups: Group[] = [];

  exercises.forEach((ex) => {
    if (ex.section_start !== undefined) {
      groups.push({ name: ex.section_start || null, items: [ex] });
    } else if (groups.length === 0) {
      groups.push({ name: null, items: [ex] });
    } else {
      groups[groups.length - 1].items.push(ex);
    }
  });

  const sectionRank = (name: string | null): number => {
    if (name === null) return -1;
    const idx = CANONICAL_SECTION_ORDER.indexOf(name as typeof CANONICAL_SECTION_ORDER[number]);
    return idx >= 0 ? idx : CANONICAL_SECTION_ORDER.length;
  };

  groups.sort((a, b) => sectionRank(a.name) - sectionRank(b.name));

  const result: PTProgrammeExercise[] = [];
  groups.forEach((group) => {
    group.items.forEach((ex, i) => {
      if (i === 0 && group.name !== null) {
        result.push({ ...ex, section_start: group.name });
      } else {
        result.push({ ...ex, section_start: undefined });
      }
    });
  });

  return result;
}

export function getPhaseStartWeeks(phases: PTProgrammePhase[]): number[] {
  const startWeeks: number[] = [];
  let cumulative = 1;
  for (const phase of phases) {
    startWeeks.push(cumulative);
    const weeks = parseInt(phase.weeks, 10);
    cumulative += Number.isFinite(weeks) && weeks > 0 ? weeks : 0;
  }
  return startWeeks;
}

export function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function safeProgramme(value: unknown): PTProgramme {
  if (!value || typeof value !== 'object') return emptyProgramme;
  const phases = 'phases' in value ? (value as { phases: unknown }).phases : [];
  if (!Array.isArray(phases)) return emptyProgramme;

  return {
    phases: phases.map((phase, phaseIndex) => {
      const p = phase as Record<string, unknown>;
      const days = Array.isArray(p.days) ? p.days : [];
      return {
        id: typeof p.id === 'string' ? p.id : makeId(`phase_${phaseIndex}`),
        title: text(p.title, `Phase ${phaseIndex + 1}`),
        focus: text(p.focus, ''),
        weeks: text(p.weeks, ''),
        progression: text(p.progression, ''),
        week_blocks: safeWeekBlocks(p.week_blocks),
        days: days.map((day, dayIndex) => {
          const d = day as Record<string, unknown>;
          const exercises = Array.isArray(d.exercises) ? d.exercises : [];
          return {
            id: typeof d.id === 'string' ? d.id : makeId(`day_${dayIndex}`),
            title: text(d.title, `Day ${dayIndex + 1}`),
            focus: text(d.focus, ''),
            exercises: exercises.map((exercise, exerciseIndex) =>
              safeExercise(exercise, exerciseIndex),
            ),
          };
        }),
      };
    }),
  };
}

export function countProgrammeWeeks(programme: PTProgramme) {
  const numbers = programme.phases
    .flatMap((phase) => phase.weeks.match(/\d+/g) ?? [])
    .map((n) => Number(n))
    .filter(Number.isFinite);

  return numbers.length > 0 ? Math.max(...numbers) : programme.phases.length;
}

export function exerciseFromLibrary(exercise: PTExercise): PTProgrammeExercise {
  return {
    id: makeId('exercise'),
    exercise_id: exercise.id,
    name: exercise.name,
    sets: '3',
    reps: '8-12',
    rest: '60-90 sec',
    notes: exercise.purpose ?? '',
    video_url: exercise.video_url,
    cues: exercise.cues.slice(0, 4),
  };
}

function safeExercise(value: unknown, index: number): PTProgrammeExercise {
  const e = value as Record<string, unknown>;
  return {
    id: typeof e.id === 'string' ? e.id : makeId(`exercise_${index}`),
    exercise_id: typeof e.exercise_id === 'string' ? e.exercise_id : null,
    name: text(e.name, `Exercise ${index + 1}`),
    sets: text(e.sets, ''),
    reps: text(e.reps, ''),
    rest: text(e.rest, ''),
    notes: text(e.notes, ''),
    video_url: typeof e.video_url === 'string' ? e.video_url : null,
    cues: Array.isArray(e.cues) ? e.cues.map((cue) => String(cue)).slice(0, 4) : [],
    superset_id: typeof e.superset_id === 'string' ? e.superset_id : null,
    section_start: typeof e.section_start === 'string' && e.section_start ? e.section_start : undefined,
    week_overrides: safeBlockOverrides(e.week_overrides),
  };
}

function text(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback;
}

function safeWeekBlocks(value: unknown): PTProgrammeWeekBlock[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const blocks = value
    .map((b) => {
      const block = b as Record<string, unknown>;
      const weeks = typeof block.weeks === 'number' ? block.weeks : parseInt(String(block.weeks), 10);
      const sets = text(block.sets, '');
      const weight_pct = text(block.weight_pct, '');
      return { weeks, sets: sets || undefined, weight_pct: weight_pct || undefined };
    })
    .filter((b) => Number.isFinite(b.weeks) && b.weeks > 0 && (b.sets || b.weight_pct));
  return blocks.length > 0 ? blocks : undefined;
}

function normalizeWordNumbers(text: string): string {
  const ORDINAL_WEEKS: Record<string, string> = {
    first: '1', second: '2', third: '3', fourth: '4', fifth: '5',
    sixth: '6', seventh: '7', eighth: '8', ninth: '9', tenth: '10',
  };
  const CARDINALS: Record<string, string> = {
    one: '1', two: '2', three: '3', four: '4', five: '5',
    six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
    eleven: '11', twelve: '12',
  };
  // "first week" → "1 week" (ordinal directly before "week", not before a number like "first 2 weeks")
  let result = text.replace(
    /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+week\b/gi,
    (_, ord) => `${ORDINAL_WEEKS[ord.toLowerCase()] ?? ord} week`,
  );
  return result.replace(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi,
    (m) => CARDINALS[m.toLowerCase()] ?? m,
  );
}

export function parseWeekBlocks(input: string): PTProgrammeWeekBlock[] {
  const normalized = normalizeWordNumbers(input);

  // Pattern 1: "N sets [...] M weeks" (typed format: "2 sets for the first 2 weeks")
  const p1: PTProgrammeWeekBlock[] = [];
  const re1 = /(\d+)\s*sets?[^0-9]*?(\d+)\s*weeks?/gi;
  let m = re1.exec(normalized);
  while (m !== null) { p1.push({ sets: m[1], weeks: parseInt(m[2], 10) }); m = re1.exec(normalized); }

  // Pattern 2: "N weeks [...] M sets" (voice format: "1 week to have 1 set")
  const p2: PTProgrammeWeekBlock[] = [];
  const re2 = /(\d+)\s*weeks?[^0-9]*?(\d+)\s*sets?/gi;
  m = re2.exec(normalized);
  while (m !== null) { p2.push({ weeks: parseInt(m[1], 10), sets: m[2] }); m = re2.exec(normalized); }

  // Pattern 3: "75% [...] 1 week" (typed format: "75% for 1 week, 85% for 3 weeks")
  const p3: PTProgrammeWeekBlock[] = [];
  const re3 = /(\d+(?:\.\d+)?)\s*%[^0-9]*?(\d+)\s*weeks?/gi;
  m = re3.exec(normalized);
  while (m !== null) { p3.push({ weight_pct: `${m[1]}%`, weeks: parseInt(m[2], 10) }); m = re3.exec(normalized); }

  // Pattern 4: "1 week [...] 75%" (voice format)
  const p4: PTProgrammeWeekBlock[] = [];
  const re4 = /(\d+)\s*weeks?[^0-9]*?(\d+(?:\.\d+)?)\s*%/gi;
  m = re4.exec(normalized);
  while (m !== null) { p4.push({ weeks: parseInt(m[1], 10), weight_pct: `${m[2]}%` }); m = re4.exec(normalized); }

  const candidates = [p1, p2, p3, p4].filter((blocks) => blocks.length > 0);
  return candidates.sort((a, b) => b.length - a.length)[0] ?? [];
}

export function formatWeekBlocks(blocks: PTProgrammeWeekBlock[] | undefined): string {
  if (!blocks || blocks.length === 0) return '';
  return blocks.map((b) => {
    const value = b.sets ? `${b.sets} sets` : b.weight_pct ? b.weight_pct : '';
    return `${value} for ${b.weeks} weeks`;
  }).join(', ');
}

export function getBlockSets(
  exerciseSets: string,
  weekBlocks: PTProgrammeWeekBlock[] | undefined,
  blockIndex: number,
): string {
  if (!weekBlocks || weekBlocks.length === 0) return exerciseSets;
  const block = weekBlocks[Math.min(blockIndex, weekBlocks.length - 1)];
  return block?.sets ?? exerciseSets;
}

export function getExerciseBlockValues(
  exercise: PTProgrammeExercise,
  weekBlocks: PTProgrammeWeekBlock[] | undefined,
  blockIndex: number,
): { sets: string; reps: string; weight_pct: string; notes: string } {
  const override = exercise.week_overrides?.find((o) => o.block_index === blockIndex);
  const blockSets = weekBlocks
    ? (weekBlocks[Math.min(blockIndex, weekBlocks.length - 1)]?.sets ?? exercise.sets)
    : exercise.sets;
  const blockWeightPct = weekBlocks
    ? (weekBlocks[Math.min(blockIndex, weekBlocks.length - 1)]?.weight_pct ?? '')
    : '';
  return {
    sets: override?.sets ?? blockSets,
    reps: override?.reps ?? exercise.reps,
    weight_pct: override?.weight_pct ?? blockWeightPct,
    notes: override?.notes ?? exercise.notes,
  };
}

function safeBlockOverrides(value: unknown): PTProgrammeExerciseBlockOverride[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const overrides = value
    .map((o): PTProgrammeExerciseBlockOverride | null => {
      const item = o as Record<string, unknown>;
      const block_index = typeof item.block_index === 'number' ? item.block_index : parseInt(String(item.block_index), 10);
      if (!Number.isFinite(block_index)) return null;
      return {
        block_index,
        sets: typeof item.sets === 'string' ? item.sets : undefined,
        reps: typeof item.reps === 'string' ? item.reps : undefined,
        weight_pct: typeof item.weight_pct === 'string' ? item.weight_pct : undefined,
        notes: typeof item.notes === 'string' ? item.notes : undefined,
      };
    })
    .filter((o): o is PTProgrammeExerciseBlockOverride => o !== null);
  return overrides.length > 0 ? overrides : undefined;
}

export function requiredWorkoutsForBlock(
  weekBlocks: PTProgrammeWeekBlock[] | undefined,
  blockIndex: number,
  daysInPhase: number,
): number {
  if (!weekBlocks || !weekBlocks[blockIndex]) return 0;
  return weekBlocks[blockIndex].weeks * daysInPhase;
}
