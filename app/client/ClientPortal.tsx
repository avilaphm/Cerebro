'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronLeft, ChevronRight, Minus, Play, Plus } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { safeProgramme, getExerciseBlockValues, requiredWorkoutsForBlock } from '@/utils/pt/programme';
import { isPedroAdminEmail } from '@/utils/pt/access';
import type {
  PTClient,
  PTProgramAssignment,
  PTProgrammeDay,
  PTProgrammeExercise,
  PTProgrammePhase,
  PTProgrammeWeekBlock,
  PTSetLog,
} from '@/utils/pt/types';
import MessageBubble from './MessageBubble';

interface SetDraft {
  reps: string;
  weight: string;
}

interface WorkoutLog {
  id: string;
  phase_index: number;
  day_index: number;
  week_number: number;
  block_index: number | null;
  is_quick_done: boolean;
}

interface PhaseProgress {
  blockIndex: number;
  weekWithinBlock: number;
  block: PTProgrammeWeekBlock | null;
  allBlocksDone: boolean;
}

interface SelectedWorkout {
  phaseIndex: number;
  dayIndex: number;
  started: boolean;
}

interface WorkoutExerciseView {
  exercise: PTProgrammeExercise;
  values: ReturnType<typeof getExerciseBlockValues>;
}

interface WorkoutSectionView {
  id: string;
  title: string;
  exercises: WorkoutExerciseView[];
}

function calcPhaseProgress(
  logs: WorkoutLog[],
  phaseIndex: number,
  weekBlocks: PTProgrammeWeekBlock[] | undefined,
  daysInPhase: number,
): PhaseProgress | null {
  if (!weekBlocks || weekBlocks.length === 0) return null;

  for (let bi = 0; bi < weekBlocks.length; bi++) {
    const block = weekBlocks[bi];
    const required = requiredWorkoutsForBlock(weekBlocks, bi, daysInPhase);
    const logsInBlock = logs.filter(
      (l) => l.phase_index === phaseIndex && l.block_index === bi,
    );
    const distinct = new Set(logsInBlock.map((l) => `${l.week_number}-${l.day_index}`));

    if (distinct.size < required) {
      const weekMap = new Map<number, Set<number>>();
      logsInBlock.forEach((l) => {
        if (!weekMap.has(l.week_number)) weekMap.set(l.week_number, new Set());
        weekMap.get(l.week_number)!.add(l.day_index);
      });
      let currentWeek = 1;
      for (let w = 1; w <= block.weeks; w++) {
        if ((weekMap.get(w)?.size ?? 0) < daysInPhase) {
          currentWeek = w;
          break;
        }
      }
      return { blockIndex: bi, weekWithinBlock: currentWeek, block, allBlocksDone: false };
    }
  }

  const lastBlock = weekBlocks[weekBlocks.length - 1];
  return {
    blockIndex: weekBlocks.length - 1,
    weekWithinBlock: lastBlock.weeks,
    block: lastBlock,
    allBlocksDone: true,
  };
}

function parseSets(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function toNullableNumber(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function draftKey(phaseIndex: number, dayIndex: number, exerciseId: string, setIndex: number) {
  return `${phaseIndex}-${dayIndex}-${exerciseId}-${setIndex}`;
}

function sectionNoteKey(phaseIndex: number, dayIndex: number, sectionId: string) {
  return `${phaseIndex}-${dayIndex}-${sectionId}`;
}

function getWorkoutSections(
  day: PTProgrammeDay,
  phase: PTProgrammePhase,
  blockIndex: number,
): WorkoutSectionView[] {
  const sections: WorkoutSectionView[] = [];

  day.exercises.forEach((exercise, index) => {
    const title = exercise.section_start?.trim() || (sections.length === 0 ? 'Main work' : '');
    if (index === 0 || exercise.section_start || sections.length === 0) {
      sections.push({
        id: `${index}-${title || 'section'}`,
        title: title || 'Main work',
        exercises: [],
      });
    }

    sections[sections.length - 1].exercises.push({
      exercise,
      values: getExerciseBlockValues(exercise, phase.week_blocks, blockIndex),
    });
  });

  return sections;
}

function workoutIsDone(
  logs: WorkoutLog[],
  phaseIndex: number,
  dayIndex: number,
  progress: PhaseProgress | null,
) {
  if (!progress) {
    return logs.some((l) => l.phase_index === phaseIndex && l.day_index === dayIndex);
  }

  return logs.some(
    (l) =>
      l.phase_index === phaseIndex &&
      l.day_index === dayIndex &&
      l.block_index === progress.blockIndex &&
      l.week_number === progress.weekWithinBlock,
  );
}

export default function ClientPortal({ userEmail }: { userEmail: string }) {
  const supabase = createClient();
  const router = useRouter();
  const isPedro = isPedroAdminEmail(userEmail);
  const [client, setClient] = useState<PTClient | null>(null);
  const [assignments, setAssignments] = useState<PTProgramAssignment[]>([]);
  const [setLogs, setSetLogs] = useState<PTSetLog[]>([]);
  const [workoutLogs, setWorkoutLogs] = useState<WorkoutLog[]>([]);
  const [setDrafts, setSetDrafts] = useState<Record<string, SetDraft>>({});
  const [setCounts, setSetCounts] = useState<Record<string, number>>({});
  const [sectionNotes, setSectionNotes] = useState<Record<string, string>>({});
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [selectedWorkout, setSelectedWorkout] = useState<SelectedWorkout | null>(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingWorkout, setSavingWorkout] = useState(false);
  const [activeContext, setActiveContext] = useState<{
    phase_index: number; phase_title: string; day_index: number; day_title: string;
  } | null>(null);

  const loadPortal = useCallback(async () => {
    setLoading(true);
    const { data: clientRows, error: clientError } = await supabase
      .from('pt_clients')
      .select('*')
      .limit(1);

    if (clientError) console.error(clientError);
    const currentClient = ((clientRows ?? []) as PTClient[])[0] ?? null;
    setClient(currentClient);

    if (!currentClient) {
      setLoading(false);
      return;
    }

    const [assignmentRes, logsRes, workoutLogsRes] = await Promise.all([
      supabase
        .from('pt_program_assignments')
        .select('*')
        .eq('client_id', currentClient.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false }),
      supabase
        .from('pt_set_logs')
        .select('*')
        .eq('client_id', currentClient.id)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('pt_workout_logs')
        .select('id, phase_index, day_index, week_number, block_index, is_quick_done')
        .eq('client_id', currentClient.id)
        .order('created_at', { ascending: false }),
    ]);

    setAssignments(((assignmentRes.data ?? []) as PTProgramAssignment[]).map((row) => ({
      ...row,
      programme: safeProgramme(row.programme),
      current_week: (row as PTProgramAssignment).current_week ?? 1,
      current_block_index: (row as PTProgramAssignment).current_block_index ?? 0,
    })));
    setSetLogs((logsRes.data ?? []) as PTSetLog[]);
    setWorkoutLogs((workoutLogsRes.data ?? []) as WorkoutLog[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    const id = window.setTimeout(() => { void loadPortal(); }, 0);
    return () => window.clearTimeout(id);
  }, [loadPortal]);

  const assignment = assignments[0] ?? null;
  const phaseProgress = useMemo(() => {
    if (!assignment) return [];
    return assignment.programme.phases.map((phase, phaseIndex) =>
      calcPhaseProgress(workoutLogs, phaseIndex, phase.week_blocks, phase.days.length),
    );
  }, [assignment, workoutLogs]);

  const activePhaseIndex = useMemo(() => {
    if (!assignment) return 0;
    const next = phaseProgress.findIndex((progress) => progress && !progress.allBlocksDone);
    if (next >= 0) return next;
    return 0;
  }, [assignment, phaseProgress]);

  const activePhase = assignment?.programme.phases[activePhaseIndex] ?? null;
  const activeProgress = phaseProgress[activePhaseIndex] ?? null;
  const selectedPhase = selectedWorkout && assignment
    ? assignment.programme.phases[selectedWorkout.phaseIndex]
    : null;
  const selectedDay = selectedWorkout && selectedPhase
    ? selectedPhase.days[selectedWorkout.dayIndex]
    : null;
  const selectedProgress = selectedWorkout
    ? phaseProgress[selectedWorkout.phaseIndex] ?? null
    : null;

  const lastWeightByExercise = useMemo(() => {
    const map = new Map<string, PTSetLog>();
    setLogs.forEach((log) => {
      const key = log.exercise_id ?? log.exercise_name.toLowerCase();
      if (!map.has(key) && log.weight !== null) map.set(key, log);
    });
    return map;
  }, [setLogs]);

  const updateSetDraft = (key: string, patch: Partial<SetDraft>) => {
    setSetDrafts((current) => ({
      ...current,
      [key]: {
        reps: current[key]?.reps ?? '',
        weight: current[key]?.weight ?? '',
        ...patch,
      },
    }));
  };

  const setExerciseCount = (key: string, nextCount: number) => {
    setSetCounts((current) => ({
      ...current,
      [key]: Math.max(1, nextCount),
    }));
  };

  const openWorkout = (phaseIndex: number, dayIndex: number) => {
    if (!assignment) return;
    const phase = assignment.programme.phases[phaseIndex];
    const day = phase.days[dayIndex];
    const progress = phaseProgress[phaseIndex] ?? null;
    const blockIndex = progress?.blockIndex ?? 0;

    setStatus('');
    setSelectedWorkout({ phaseIndex, dayIndex, started: false });
    setActiveContext({ phase_index: phaseIndex, phase_title: phase.title, day_index: dayIndex, day_title: day.title });

    const initialCounts: Record<string, number> = {};
    const initialSections: Record<string, boolean> = {};
    getWorkoutSections(day, phase, blockIndex).forEach((section, index) => {
      initialSections[section.id] = index === 0;
      section.exercises.forEach(({ exercise, values }) => {
        initialCounts[exercise.id] = parseSets(values.sets);
      });
    });
    setSetCounts((current) => ({ ...initialCounts, ...current }));
    setOpenSections(initialSections);
  };

  const closeWorkout = () => {
    setSelectedWorkout(null);
    setStatus('');
  };

  const finishWorkout = async () => {
    if (!client || !assignment || !selectedWorkout || !selectedPhase || !selectedDay) return;
    setSavingWorkout(true);
    setStatus('Saving workout...');

    const progress = selectedProgress;
    const blockIndex = progress?.blockIndex ?? null;
    const weekWithinBlock = progress?.weekWithinBlock ?? 1;
    const sections = getWorkoutSections(selectedDay, selectedPhase, progress?.blockIndex ?? 0);

    const notes = sections
      .map((section) => {
        const note = sectionNotes[sectionNoteKey(selectedWorkout.phaseIndex, selectedWorkout.dayIndex, section.id)]?.trim();
        return note ? `${section.title}: ${note}` : null;
      })
      .filter((note): note is string => Boolean(note))
      .join('\n\n') || null;

    const { data: workout, error: workoutError } = await supabase
      .from('pt_workout_logs')
      .insert({
        client_id: client.id,
        assignment_id: assignment.id,
        phase_index: selectedWorkout.phaseIndex,
        day_index: selectedWorkout.dayIndex,
        week_number: weekWithinBlock,
        block_index: blockIndex,
        workout_title: selectedDay.title,
        notes,
        is_quick_done: false,
      })
      .select('id')
      .single();

    if (workoutError || !workout) {
      setStatus(workoutError?.message ?? 'Could not save workout.');
      setSavingWorkout(false);
      return;
    }

    const workoutId = (workout as { id: string }).id;
    const rows = sections.flatMap((section) =>
      section.exercises.flatMap(({ exercise }) => {
        const count = setCounts[exercise.id] ?? 1;
        return Array.from({ length: count }).map((_, setIndex) => {
          const key = draftKey(selectedWorkout.phaseIndex, selectedWorkout.dayIndex, exercise.id, setIndex);
          const draft = setDrafts[key];
          return {
            workout_log_id: workoutId,
            client_id: client.id,
            assignment_id: assignment.id,
            exercise_id: exercise.exercise_id,
            exercise_name: exercise.name,
            set_number: setIndex + 1,
            reps: toNullableNumber(draft?.reps),
            weight: toNullableNumber(draft?.weight),
            notes: null,
          };
        });
      }),
    );

    const { error: setError } = rows.length > 0
      ? await supabase.from('pt_set_logs').insert(rows)
      : { error: null };

    if (setError) {
      setStatus(setError.message);
      setSavingWorkout(false);
      return;
    }

    await supabase.from('pt_events').insert({
      client_id: client.id,
      assignment_id: assignment.id,
      event_type: 'workout_logged',
      metadata: {
        workout_title: selectedDay.title,
        phase_index: selectedWorkout.phaseIndex,
        day_index: selectedWorkout.dayIndex,
        block_index: blockIndex,
        week_number: weekWithinBlock,
        section_notes: notes,
      },
    });

    if (progress && !progress.allBlocksDone && selectedPhase) {
      const newLogs: WorkoutLog[] = [
        ...workoutLogs,
        {
          id: workoutId,
          phase_index: selectedWorkout.phaseIndex,
          day_index: selectedWorkout.dayIndex,
          week_number: weekWithinBlock,
          block_index: blockIndex,
          is_quick_done: false,
        },
      ];
      const newProgress = calcPhaseProgress(
        newLogs,
        selectedWorkout.phaseIndex,
        selectedPhase.week_blocks,
        selectedPhase.days.length,
      );

      if (newProgress && newProgress.blockIndex > progress.blockIndex) {
        await supabase
          .from('pt_program_assignments')
          .update({
            current_block_index: newProgress.blockIndex,
            current_week: newProgress.weekWithinBlock,
          })
          .eq('id', assignment.id);
      }
    }

    setStatus('Workout saved.');
    setSavingWorkout(false);
    setSelectedWorkout(null);
    await loadPortal();
  };

  const renderHeader = () => (
    <header className="border-b border-black/10 bg-white px-5 py-5 md:px-10">
      <p className="text-[0.65rem] uppercase tracking-[0.2em] text-black/35">Pedro Avila Coaching</p>
      <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <h1 className="font-display text-3xl font-light tracking-[-0.02em]">Training</h1>
        <div className="flex items-center gap-4">
          <p className="text-xs text-black/40">{userEmail}</p>
          {isPedro ? (
            <a href="/dashboard" className="text-xs text-black/50 underline hover:text-black">Back to dashboard</a>
          ) : (
            <button
              type="button"
              onClick={async () => { await supabase.auth.signOut(); router.push('/client-login'); }}
              className="text-xs text-black/40 hover:text-black"
            >
              Sign out
            </button>
          )}
        </div>
      </div>
    </header>
  );

  const renderProgress = (phase: PTProgrammePhase, progress: PhaseProgress | null) => {
    if (!phase.week_blocks || phase.week_blocks.length === 0 || !progress) return null;

    return (
      <div className="mt-5 border border-black/8 bg-[#fbfbf8] px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[0.6rem] uppercase tracking-[0.15em] text-black/35">Progress</p>
          {progress.allBlocksDone ? (
            <span className="text-[0.6rem] uppercase tracking-[0.1em] border border-green-300 bg-green-50 px-2 py-0.5 text-green-700">
              Phase complete
            </span>
          ) : (
            <span className="text-[0.65rem] text-black/50">
              Block {progress.blockIndex + 1} of {phase.week_blocks.length} · Week {progress.weekWithinBlock} of {progress.block?.weeks ?? '?'} · {progress.block?.sets ?? '?'} sets
            </span>
          )}
        </div>
        <div className="flex gap-1.5">
          {phase.week_blocks.map((block, bi) => {
            const isDone = progress.allBlocksDone || bi < progress.blockIndex;
            const isCurrent = !progress.allBlocksDone && bi === progress.blockIndex;
            return (
              <div
                key={`${block.sets}-${bi}`}
                className={`flex-1 py-1.5 text-center text-[0.55rem] uppercase tracking-[0.1em] ${
                  isDone
                    ? 'bg-black text-white'
                    : isCurrent
                    ? 'border border-black/30 bg-black/10 text-black/70'
                    : 'border border-black/8 bg-black/4 text-black/25'
                }`}
              >
                {block.sets} sets
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderWorkoutPreview = () => {
    if (!selectedWorkout || !selectedPhase || !selectedDay) return null;
    const sections = getWorkoutSections(selectedDay, selectedPhase, selectedProgress?.blockIndex ?? 0);

    return (
      <div className="mx-auto max-w-3xl">
        <button
          type="button"
          onClick={closeWorkout}
          className="mb-5 inline-flex items-center gap-2 text-sm text-black/45 hover:text-black"
        >
          <ChevronLeft className="h-4 w-4" />
          Phase {selectedWorkout.phaseIndex + 1}
        </button>

        <section className="border border-black/10 bg-white p-5">
          <p className="text-[0.6rem] uppercase tracking-[0.18em] text-black/35">Workout preview</p>
          <h2 className="mt-2 font-display text-3xl font-light">{selectedDay.title}</h2>
          {selectedDay.focus && <p className="mt-2 text-sm leading-relaxed text-black/55">{selectedDay.focus}</p>}

          <div className="mt-6 space-y-5">
            {sections.map((section) => (
              <div key={section.id} className="border-t border-black/8 pt-4">
                <p className="text-[0.65rem] uppercase tracking-[0.18em] text-black/35">{section.title}</p>
                <div className="mt-3 space-y-3">
                  {section.exercises.map(({ exercise, values }, index) => (
                    <div key={exercise.id} className="grid grid-cols-[2rem_1fr] gap-3">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-black text-xs text-white">{index + 1}</div>
                      <div>
                        <p className="text-sm font-medium">{exercise.name}</p>
                        <p className="mt-1 text-xs text-black/45">
                          {values.sets || '?'} sets · {values.reps || '?'} reps · {exercise.rest || 'Rest as needed'}
                          {values.weight_pct && <span className="ml-2 text-amber-700">@ {values.weight_pct} 1RM</span>}
                        </p>
                        {values.notes && <p className="mt-1 text-xs leading-relaxed text-black/45">{values.notes}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setSelectedWorkout({ ...selectedWorkout, started: true })}
            className="mt-7 flex w-full items-center justify-center gap-2 bg-black px-5 py-4 text-sm font-medium text-white transition-colors hover:bg-black/80 active:scale-[0.99]"
          >
            <Play className="h-4 w-4" />
            Begin workout
          </button>
        </section>
      </div>
    );
  };

  const renderWorkoutLogger = () => {
    if (!selectedWorkout || !selectedPhase || !selectedDay) return null;
    const sections = getWorkoutSections(selectedDay, selectedPhase, selectedProgress?.blockIndex ?? 0);

    return (
      <div className="mx-auto max-w-3xl pb-24">
        <button
          type="button"
          onClick={() => setSelectedWorkout({ ...selectedWorkout, started: false })}
          className="mb-5 inline-flex items-center gap-2 text-sm text-black/45 hover:text-black"
        >
          <ChevronLeft className="h-4 w-4" />
          Preview
        </button>

        <div className="mb-5">
          <p className="text-[0.65rem] uppercase tracking-[0.18em] text-black/35">Logging</p>
          <h2 className="mt-1 font-display text-3xl font-light">{selectedDay.title}</h2>
        </div>

        <div className="space-y-4">
          {sections.map((section) => {
            const noteKey = sectionNoteKey(selectedWorkout.phaseIndex, selectedWorkout.dayIndex, section.id);
            const isOpen = openSections[section.id] ?? false;
            return (
              <section key={section.id} className="border border-black/10 bg-white">
                <button
                  type="button"
                  onClick={() => setOpenSections((current) => ({ ...current, [section.id]: !isOpen }))}
                  className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left"
                >
                  <div>
                    <p className="text-[0.6rem] uppercase tracking-[0.18em] text-black/35">{section.title}</p>
                    <p className="mt-1 text-sm text-black/55">{section.exercises.length} exercise{section.exercises.length === 1 ? '' : 's'}</p>
                  </div>
                  <ChevronRight className={`h-5 w-5 text-black/35 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                </button>

                {isOpen && (
                  <div className="border-t border-black/8 px-4 pb-5 pt-1">
                    <div className="space-y-4">
                      {section.exercises.map(({ exercise, values }) => {
                        const count = setCounts[exercise.id] ?? parseSets(values.sets);
                        const historyKey = exercise.exercise_id ?? exercise.name.toLowerCase();
                        const last = lastWeightByExercise.get(historyKey);

                        return (
                          <div key={exercise.id} className="border border-black/8 bg-[#fbfbf8] p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-medium">{exercise.name}</p>
                                <p className="mt-1 text-xs text-black/45">
                                  Target: {values.sets || '?'} sets · {values.reps || '?'} reps
                                </p>
                                {last && (
                                  <p className="mt-1 text-xs text-black/35">
                                    Last: {last.weight ?? '-'}kg x {last.reps ?? '-'}
                                  </p>
                                )}
                              </div>
                              {exercise.video_url && (
                                <a href={exercise.video_url} target="_blank" className="text-xs text-black/45 underline hover:text-black">
                                  Demo
                                </a>
                              )}
                            </div>

                            <div className="mt-4 space-y-2">
                              {Array.from({ length: count }).map((_, setIndex) => {
                                const key = draftKey(selectedWorkout.phaseIndex, selectedWorkout.dayIndex, exercise.id, setIndex);
                                const draft = setDrafts[key] ?? { reps: '', weight: '' };
                                return (
                                  <div key={key} className="grid grid-cols-[3.5rem_1fr_1fr] gap-2">
                                    <div className="border border-black/10 bg-white px-2 py-2 text-xs text-black/40">Set {setIndex + 1}</div>
                                    <input
                                      value={draft.weight}
                                      onChange={(event) => updateSetDraft(key, { weight: event.target.value })}
                                      className="min-w-0 border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/35"
                                      placeholder="Weight"
                                      inputMode="decimal"
                                    />
                                    <input
                                      value={draft.reps}
                                      onChange={(event) => updateSetDraft(key, { reps: event.target.value })}
                                      className="min-w-0 border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/35"
                                      placeholder="Reps"
                                      inputMode="decimal"
                                    />
                                  </div>
                                );
                              })}
                            </div>

                            <div className="mt-3 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setExerciseCount(exercise.id, count - 1)}
                                className="inline-flex h-8 w-8 items-center justify-center border border-black/10 text-black/45 hover:border-black/30 hover:text-black disabled:opacity-30"
                                disabled={count <= 1}
                                aria-label="Remove set"
                              >
                                <Minus className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setExerciseCount(exercise.id, count + 1)}
                                className="inline-flex h-8 w-8 items-center justify-center border border-black/10 text-black/45 hover:border-black/30 hover:text-black"
                                aria-label="Add set"
                              >
                                <Plus className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <label className="mt-4 block">
                      <span className="text-[0.6rem] uppercase tracking-[0.18em] text-black/35">Notes for Pedro</span>
                      <textarea
                        value={sectionNotes[noteKey] ?? ''}
                        onChange={(event) => setSectionNotes((current) => ({ ...current, [noteKey]: event.target.value }))}
                        rows={3}
                        className="mt-2 w-full resize-none border border-black/10 bg-[#fbfbf8] px-3 py-3 text-sm outline-none focus:border-black/35"
                        placeholder="Anything that felt off, easy, painful, or worth changing."
                      />
                    </label>
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => void finishWorkout()}
          disabled={savingWorkout}
          className="mt-6 flex w-full items-center justify-center gap-2 bg-black px-5 py-4 text-sm font-medium text-white transition-colors hover:bg-black/80 disabled:cursor-wait disabled:opacity-50"
        >
          <Check className="h-4 w-4" />
          {savingWorkout ? 'Saving...' : 'Finish workout'}
        </button>
      </div>
    );
  };

  return (
    <main className="min-h-screen bg-[#f7f7f3] text-black">
      {renderHeader()}

      <div className="p-5 md:p-10">
        {status && (
          <div className="mb-5 border border-black/10 bg-white px-4 py-3 text-sm text-black/60">
            {status}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-black/40">Loading programme...</p>
        ) : !client ? (
          <div className="border border-black/10 bg-white p-6">
            <p className="text-sm text-black/55">No client profile is linked to this login yet. Ask Pedro to send a fresh invite.</p>
          </div>
        ) : !assignment || !activePhase ? (
          <div className="border border-black/10 bg-white p-6">
            <p className="text-sm font-medium text-black">
              {client.name ? `Hi ${client.name.split(' ')[0]}.` : 'Welcome.'}
            </p>
            <p className="mt-2 text-sm text-black/55">
              Your programme is being created. It will appear here as soon as it is live.
            </p>
          </div>
        ) : selectedWorkout?.started ? (
          renderWorkoutLogger()
        ) : selectedWorkout ? (
          renderWorkoutPreview()
        ) : (
          <div className="mx-auto max-w-5xl space-y-6">
            <section className="border border-black/10 bg-white p-5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Active programme</p>
              <h2 className="mt-2 font-display text-2xl font-light">{assignment.name}</h2>
              {assignment.goal && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-black/55">{assignment.goal}</p>}
            </section>

            <section className="border border-black/10 bg-white p-5">
              <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Phase {activePhaseIndex + 1}</p>
                  <h3 className="mt-1 font-display text-3xl font-light">{activePhase.title}</h3>
                  {activePhase.focus && <p className="mt-2 text-sm text-black/50">{activePhase.focus}</p>}
                </div>
                {activePhase.progression && <p className="max-w-md text-sm leading-relaxed text-black/45">{activePhase.progression}</p>}
              </div>

              {renderProgress(activePhase, activeProgress)}

              <div className="mt-6 grid gap-3 md:grid-cols-3">
                {activePhase.days.map((day, dayIndex) => {
                  const done = workoutIsDone(workoutLogs, activePhaseIndex, dayIndex, activeProgress);
                  const sections = getWorkoutSections(day, activePhase, activeProgress?.blockIndex ?? 0);
                  const exerciseCount = day.exercises.length;

                  return (
                    <button
                      key={day.id}
                      type="button"
                      onClick={() => openWorkout(activePhaseIndex, dayIndex)}
                      className={`group border p-4 text-left transition-colors ${
                        done
                          ? 'border-green-300 bg-green-50/50 hover:border-green-500'
                          : 'border-black/10 bg-[#fbfbf8] hover:border-black/35 hover:bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[0.6rem] uppercase tracking-[0.16em] text-black/35">Workout {dayIndex + 1}</p>
                          <h4 className="mt-2 text-lg font-medium">{day.title}</h4>
                        </div>
                        {done ? (
                          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-green-600 text-white">
                            <Check className="h-4 w-4" />
                          </span>
                        ) : (
                          <ChevronRight className="mt-1 h-5 w-5 text-black/25 transition-transform group-hover:translate-x-0.5 group-hover:text-black" />
                        )}
                      </div>
                      {day.focus && <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-black/50">{day.focus}</p>}
                      <div className="mt-4 flex items-center justify-between text-xs text-black/35">
                        <span>{exerciseCount} exercise{exerciseCount === 1 ? '' : 's'}</span>
                        <span>{sections.length} section{sections.length === 1 ? '' : 's'}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </div>

      {client && !isPedro && (
        <MessageBubble
          clientId={client.id}
          workoutContext={
            activeContext && assignment
              ? {
                  assignment_id: assignment.id,
                  assignment_name: assignment.name,
                  phase_index: activeContext.phase_index,
                  phase_title: activeContext.phase_title,
                  day_index: activeContext.day_index,
                  day_title: activeContext.day_title,
                }
              : null
          }
        />
      )}
    </main>
  );
}
