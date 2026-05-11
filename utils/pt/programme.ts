import type { PTExercise, PTProgramme, PTProgrammeExercise, PTProgrammeWeekBlock, PTProgrammeExerciseBlockOverride } from './types';

export const emptyProgramme: PTProgramme = { phases: [] };

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
      return { weeks, sets };
    })
    .filter((b) => Number.isFinite(b.weeks) && b.weeks > 0 && b.sets);
  return blocks.length > 0 ? blocks : undefined;
}

export function parseWeekBlocks(input: string): PTProgrammeWeekBlock[] {
  const blocks: PTProgrammeWeekBlock[] = [];
  // "N sets for [the] [first|next|last] M weeks" — handles natural language ordinals
  const p1 = /(\d+)\s*sets?[^0-9]*?(\d+)\s*weeks?/gi;
  let m = p1.exec(input);
  while (m !== null) {
    blocks.push({ sets: m[1], weeks: parseInt(m[2], 10) });
    m = p1.exec(input);
  }
  if (blocks.length > 0) return blocks;
  // "M weeks N sets" or "M weeks, N sets"
  const p2 = /(\d+)\s*weeks?[,\s]+(\d+)\s*sets?/gi;
  m = p2.exec(input);
  while (m !== null) {
    blocks.push({ sets: m[2], weeks: parseInt(m[1], 10) });
    m = p2.exec(input);
  }
  return blocks;
}

export function formatWeekBlocks(blocks: PTProgrammeWeekBlock[] | undefined): string {
  if (!blocks || blocks.length === 0) return '';
  return blocks.map((b) => `${b.sets} sets for ${b.weeks} weeks`).join(', ');
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
  return {
    sets: override?.sets ?? blockSets,
    reps: override?.reps ?? exercise.reps,
    weight_pct: override?.weight_pct ?? '',
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
