import type { PTExercise, PTProgramme, PTProgrammeExercise } from './types';

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
  };
}

function text(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback;
}
