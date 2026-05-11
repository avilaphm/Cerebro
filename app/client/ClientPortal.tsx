'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { safeProgramme, getExerciseBlockValues, requiredWorkoutsForBlock } from '@/utils/pt/programme';
import { isPedroAdminEmail } from '@/utils/pt/access';
import type { PTClient, PTProgramAssignment, PTProgrammeExercise, PTSetLog, PTProgrammeWeekBlock } from '@/utils/pt/types';
import MessageBubble from './MessageBubble';

interface LogDraft {
  reps: string;
  weight: string;
  notes: string;
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
      (l) => l.phase_index === phaseIndex && l.block_index === bi && l.is_quick_done,
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

export default function ClientPortal({ userEmail }: { userEmail: string }) {
  const supabase = createClient();
  const router = useRouter();
  const isPedro = isPedroAdminEmail(userEmail);
  const [client, setClient] = useState<PTClient | null>(null);
  const [assignments, setAssignments] = useState<PTProgramAssignment[]>([]);
  const [setLogs, setSetLogs] = useState<PTSetLog[]>([]);
  const [workoutLogs, setWorkoutLogs] = useState<WorkoutLog[]>([]);
  const [drafts, setDrafts] = useState<Record<string, LogDraft>>({});
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [loggingDay, setLoggingDay] = useState<string | null>(null);
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
        .eq('is_quick_done', true)
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
  const lastWeightByExercise = useMemo(() => {
    const map = new Map<string, PTSetLog>();
    setLogs.forEach((log) => {
      const key = log.exercise_id ?? log.exercise_name.toLowerCase();
      if (!map.has(key) && log.weight !== null) map.set(key, log);
    });
    return map;
  }, [setLogs]);

  const updateDraft = (exerciseKey: string, patch: Partial<LogDraft>) => {
    setDrafts((current) => ({
      ...current,
      [exerciseKey]: {
        reps: current[exerciseKey]?.reps ?? '',
        weight: current[exerciseKey]?.weight ?? '',
        notes: current[exerciseKey]?.notes ?? '',
        ...patch,
      },
    }));
  };

  const logWorkout = async (
    phaseIndex: number,
    dayIndex: number,
    workoutTitle: string,
    exercises: PTProgrammeExercise[],
  ) => {
    if (!client || !assignment) return;

    const rows = exercises.flatMap((exercise) => {
      const setCount = Number.parseInt(exercise.sets, 10);
      const totalSets = Number.isFinite(setCount) && setCount > 0 ? setCount : 1;
      return Array.from({ length: totalSets }).map((_, index) => {
        const key = `${phaseIndex}-${dayIndex}-${exercise.id}-${index}`;
        const draft = drafts[key];
        return {
          exercise,
          set_number: index + 1,
          reps: draft?.reps ? Number(draft.reps) : null,
          weight: draft?.weight ? Number(draft.weight) : null,
          notes: draft?.notes || null,
        };
      });
    });

    if (rows.every((row) => row.reps === null && row.weight === null && !row.notes)) {
      setStatus('Add at least one set, rep, weight, or note before logging.');
      return;
    }

    setStatus('Saving workout...');
    const phase = assignment.programme.phases[phaseIndex];
    const progress = calcPhaseProgress(workoutLogs, phaseIndex, phase?.week_blocks, phase?.days.length ?? 0);

    const { data: workout, error: workoutError } = await supabase
      .from('pt_workout_logs')
      .insert({
        client_id: client.id,
        assignment_id: assignment.id,
        phase_index: phaseIndex,
        week_number: progress?.weekWithinBlock ?? 1,
        block_index: progress?.blockIndex ?? null,
        day_index: dayIndex,
        workout_title: workoutTitle,
        is_quick_done: false,
      })
      .select('id')
      .single();

    if (workoutError || !workout) {
      setStatus(workoutError?.message ?? 'Could not save workout.');
      return;
    }

    const workoutId = (workout as { id: string }).id;
    const { error: setError } = await supabase.from('pt_set_logs').insert(
      rows.map((row) => ({
        workout_log_id: workoutId,
        client_id: client.id,
        assignment_id: assignment.id,
        exercise_id: row.exercise.exercise_id,
        exercise_name: row.exercise.name,
        set_number: row.set_number,
        reps: row.reps,
        weight: row.weight,
        notes: row.notes,
      })),
    );

    if (!setError) {
      await supabase.from('pt_events').insert({
        client_id: client.id,
        assignment_id: assignment.id,
        event_type: 'workout_logged',
        metadata: { workout_title: workoutTitle, exercises: exercises.map((exercise) => exercise.name) },
      });
    }

    setStatus(setError ? setError.message : 'Workout logged.');
    await loadPortal();
  };

  const markWorkoutDone = async (
    phaseIndex: number,
    dayIndex: number,
    workoutTitle: string,
    progress: PhaseProgress | null,
  ) => {
    if (!client || !assignment) return;
    const key = `done-${phaseIndex}-${dayIndex}`;
    setLoggingDay(key);

    const blockIndex = progress?.blockIndex ?? null;
    const weekWithinBlock = progress?.weekWithinBlock ?? 1;

    const { error } = await supabase.from('pt_workout_logs').insert({
      client_id: client.id,
      assignment_id: assignment.id,
      phase_index: phaseIndex,
      day_index: dayIndex,
      week_number: weekWithinBlock,
      block_index: blockIndex,
      workout_title: workoutTitle,
      is_quick_done: true,
    });

    if (error) {
      setStatus(error.message);
      setLoggingDay(null);
      return;
    }

    await supabase.from('pt_events').insert({
      client_id: client.id,
      assignment_id: assignment.id,
      event_type: 'workout_done',
      metadata: { workout_title: workoutTitle, phase_index: phaseIndex, day_index: dayIndex, block_index: blockIndex, week_number: weekWithinBlock },
    });

    // Check if block should advance
    if (progress && !progress.allBlocksDone && assignment.programme.phases[phaseIndex]) {
      const phase = assignment.programme.phases[phaseIndex];
      const newLogs: WorkoutLog[] = [
        ...workoutLogs,
        { id: 'tmp', phase_index: phaseIndex, day_index: dayIndex, week_number: weekWithinBlock, block_index: blockIndex, is_quick_done: true },
      ];
      const newProgress = calcPhaseProgress(newLogs, phaseIndex, phase.week_blocks, phase.days.length);
      const advanced = newProgress && newProgress.blockIndex > progress.blockIndex;

      if (advanced && newProgress) {
        await supabase
          .from('pt_program_assignments')
          .update({
            current_block_index: newProgress.blockIndex,
            current_week: newProgress.weekWithinBlock,
          })
          .eq('id', assignment.id);
        setStatus(`Block complete! Moving to ${newProgress.block?.sets ?? '?'} sets.`);
      } else {
        setStatus('Workout done!');
      }
    } else {
      setStatus('Workout done!');
    }

    setLoggingDay(null);
    await loadPortal();
  };

  return (
    <main className="min-h-screen bg-[#f7f7f3] text-black">
      <header className="border-b border-black/10 bg-white px-5 py-5 md:px-10">
        <p className="text-[0.65rem] uppercase tracking-[0.2em] text-black/35">Cerebro PT</p>
        <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <h1 className="font-display text-3xl font-light tracking-[-0.02em]">Your programme</h1>
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
        ) : !assignment ? (
          <div className="border border-black/10 bg-white p-6">
            <p className="text-sm font-medium text-black">
              {client.name ? `Hi ${client.name.split(' ')[0]}.` : 'Welcome.'}
            </p>
            <p className="mt-2 text-sm text-black/55">
              Your programme is being created. It will appear here as soon as it is live.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <section className="border border-black/10 bg-white p-5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Active programme</p>
              <h2 className="mt-2 font-display text-2xl font-light">{assignment.name}</h2>
              {assignment.goal && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-black/55">{assignment.goal}</p>}
            </section>

            {assignment.programme.phases.map((phase, phaseIndex) => {
              const progress = calcPhaseProgress(workoutLogs, phaseIndex, phase.week_blocks, phase.days.length);

              return (
                <section key={phase.id} className="border border-black/10 bg-white p-5">
                  <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">{phase.weeks || `Phase ${phaseIndex + 1}`}</p>
                      <h3 className="mt-1 text-xl font-medium">{phase.title}</h3>
                      {phase.focus && <p className="mt-1 text-sm text-black/50">{phase.focus}</p>}
                    </div>
                    {phase.progression && <p className="max-w-md text-sm leading-relaxed text-black/45">{phase.progression}</p>}
                  </div>

                  {/* Progress strip for week blocks */}
                  {phase.week_blocks && phase.week_blocks.length > 0 && progress && (
                    <div className="mt-4 border border-black/8 bg-[#fbfbf8] px-4 py-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[0.6rem] uppercase tracking-[0.15em] text-black/35">Progress</p>
                        {progress.allBlocksDone ? (
                          <span className="text-[0.6rem] uppercase tracking-[0.1em] border border-green-300 bg-green-50 text-green-700 px-2 py-0.5">
                            Phase complete
                          </span>
                        ) : (
                          <span className="text-[0.6rem] text-black/50">
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
                              key={bi}
                              className={`flex-1 rounded-sm py-1.5 text-center text-[0.55rem] uppercase tracking-[0.1em] transition-colors ${
                                isDone
                                  ? 'bg-black text-white'
                                  : isCurrent
                                  ? 'bg-black/10 border border-black/30 text-black/70'
                                  : 'bg-black/4 border border-black/8 text-black/25'
                              }`}
                            >
                              {block.sets} sets · {block.weeks}w
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="mt-5 grid gap-4 xl:grid-cols-2">
                    {phase.days.map((day, dayIndex) => {
                      const isDayDone =
                        progress !== null &&
                        workoutLogs.some(
                          (l) =>
                            l.phase_index === phaseIndex &&
                            l.day_index === dayIndex &&
                            l.block_index === progress.blockIndex &&
                            l.week_number === progress.weekWithinBlock &&
                            l.is_quick_done,
                        );
                      const doneKey = `done-${phaseIndex}-${dayIndex}`;

                      return (
                        <div
                          key={day.id}
                          className={`border p-4 transition-colors ${isDayDone ? 'border-green-300 bg-green-50/30' : 'border-black/10 bg-[#fbfbf8]'}`}
                          onFocus={() => setActiveContext({ phase_index: phaseIndex, phase_title: phase.title, day_index: dayIndex, day_title: day.title })}
                          onPointerDown={() => setActiveContext({ phase_index: phaseIndex, phase_title: phase.title, day_index: dayIndex, day_title: day.title })}
                        >
                          <div className="mb-4 flex items-start justify-between gap-4">
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-medium">{day.title}</p>
                                {isDayDone && (
                                  <span className="text-[0.55rem] uppercase tracking-[0.1em] border border-green-400 bg-green-100 text-green-700 px-1.5 py-0.5">
                                    Done
                                  </span>
                                )}
                              </div>
                              {day.focus && <p className="mt-1 text-xs text-black/45">{day.focus}</p>}
                            </div>
                            <button
                              type="button"
                              onClick={() => logWorkout(phaseIndex, dayIndex, day.title, day.exercises)}
                              className="shrink-0 border border-black/20 px-3 py-2 text-xs text-black/60 hover:border-black hover:text-black transition-colors"
                            >
                              Log sets
                            </button>
                          </div>

                          <div className="space-y-4">
                            {day.exercises.map((exercise) => {
                              const historyKey = exercise.exercise_id ?? exercise.name.toLowerCase();
                              const last = lastWeightByExercise.get(historyKey);
                              const displaySets = progress
                                ? getBlockSets(exercise.sets, phase.week_blocks, progress.blockIndex)
                                : exercise.sets;
                              return (
                                <div key={exercise.id} className="border border-black/10 bg-white p-4">
                                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                                    <div>
                                      <p className="font-medium">{exercise.name}</p>
                                      <p className="mt-1 text-xs text-black/45">
                                        {displaySets || '?'} sets · {exercise.reps || '?'} reps · {exercise.rest || 'Rest as needed'}
                                      </p>
                                    </div>
                                    {last && (
                                      <p className="text-xs text-black/40">
                                        Last: {last.weight ?? '-'}kg x {last.reps ?? '-'}
                                      </p>
                                    )}
                                  </div>
                                  {exercise.video_url && (
                                    <a href={exercise.video_url} target="_blank" className="mt-3 block text-xs text-black/45 hover:text-black">
                                      Watch demo
                                    </a>
                                  )}
                                  <ul className="mt-3 grid gap-1 md:grid-cols-2">
                                    {exercise.cues.slice(0, 4).map((cue) => (
                                      <li key={cue} className="text-xs leading-relaxed text-black/55">• {cue}</li>
                                    ))}
                                  </ul>
                                  {exercise.notes && <p className="mt-3 text-xs leading-relaxed text-black/45">{exercise.notes}</p>}

                                  <div className="mt-4 space-y-2">
                                    {Array.from({ length: parseSets(displaySets) }).map((_, setIndex) => {
                                      const key = `${phaseIndex}-${dayIndex}-${exercise.id}-${setIndex}`;
                                      const draft = drafts[key] ?? { reps: '', weight: '', notes: '' };
                                      return (
                                        <div key={key} className="grid gap-2 md:grid-cols-[4rem_1fr_1fr_2fr]">
                                          <div className="border border-black/10 bg-[#fbfbf8] px-2 py-2 text-xs text-black/40">Set {setIndex + 1}</div>
                                          <input
                                            value={draft.reps}
                                            onChange={(event) => updateDraft(key, { reps: event.target.value })}
                                            className="border border-black/10 px-2 py-2 text-sm"
                                            placeholder="Reps"
                                            inputMode="decimal"
                                          />
                                          <input
                                            value={draft.weight}
                                            onChange={(event) => updateDraft(key, { weight: event.target.value })}
                                            className="border border-black/10 px-2 py-2 text-sm"
                                            placeholder="Weight kg"
                                            inputMode="decimal"
                                          />
                                          <input
                                            value={draft.notes}
                                            onChange={(event) => updateDraft(key, { notes: event.target.value })}
                                            className="border border-black/10 px-2 py-2 text-sm"
                                            placeholder="Notes"
                                          />
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Workout Done button */}
                          <button
                            type="button"
                            onClick={() => void markWorkoutDone(phaseIndex, dayIndex, day.title, progress)}
                            disabled={loggingDay === doneKey || isDayDone}
                            className={`mt-5 w-full py-4 text-sm font-medium tracking-wide transition-colors ${
                              isDayDone
                                ? 'border border-green-300 bg-green-50 text-green-700 cursor-default'
                                : loggingDay === doneKey
                                ? 'bg-black/50 text-white cursor-wait'
                                : 'bg-black text-white hover:bg-black/80 active:scale-[0.98]'
                            }`}
                          >
                            {isDayDone ? 'Workout done' : loggingDay === doneKey ? 'Saving…' : 'Workout done'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
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

function parseSets(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}
