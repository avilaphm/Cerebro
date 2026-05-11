'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { safeProgramme } from '@/utils/pt/programme';
import type { PTClient, PTProgramAssignment, PTProgrammeExercise, PTSetLog } from '@/utils/pt/types';

interface LogDraft {
  reps: string;
  weight: string;
  notes: string;
}

export default function ClientPortal({ userEmail }: { userEmail: string }) {
  const supabase = createClient();
  const [client, setClient] = useState<PTClient | null>(null);
  const [assignments, setAssignments] = useState<PTProgramAssignment[]>([]);
  const [setLogs, setSetLogs] = useState<PTSetLog[]>([]);
  const [drafts, setDrafts] = useState<Record<string, LogDraft>>({});
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

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

    const [assignmentRes, logsRes] = await Promise.all([
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
    ]);

    if (assignmentRes.error) console.error(assignmentRes.error);
    if (logsRes.error) console.error(logsRes.error);

    setAssignments(((assignmentRes.data ?? []) as PTProgramAssignment[]).map((row) => ({
      ...row,
      programme: safeProgramme(row.programme),
    })));
    setSetLogs((logsRes.data ?? []) as PTSetLog[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void loadPortal();
    }, 0);
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
    const { data: workout, error: workoutError } = await supabase
      .from('pt_workout_logs')
      .insert({
        client_id: client.id,
        assignment_id: assignment.id,
        phase_index: phaseIndex,
        week_number: 1,
        day_index: dayIndex,
        workout_title: workoutTitle,
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

  return (
    <main className="min-h-screen bg-[#f7f7f3] text-black">
      <header className="border-b border-black/10 bg-white px-5 py-5 md:px-10">
        <p className="text-[0.65rem] uppercase tracking-[0.2em] text-black/35">Cerebro PT</p>
        <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <h1 className="font-display text-3xl font-light tracking-[-0.02em]">Your programme</h1>
          <p className="text-xs text-black/40">{userEmail}</p>
        </div>
      </header>

      <div className="p-5 md:p-10">
        {status && <div className="mb-5 border border-black/10 bg-white px-4 py-3 text-sm text-black/60">{status}</div>}
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

            {assignment.programme.phases.map((phase, phaseIndex) => (
              <section key={phase.id} className="border border-black/10 bg-white p-5">
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">{phase.weeks || `Phase ${phaseIndex + 1}`}</p>
                    <h3 className="mt-1 text-xl font-medium">{phase.title}</h3>
                    {phase.focus && <p className="mt-1 text-sm text-black/50">{phase.focus}</p>}
                  </div>
                  {phase.progression && <p className="max-w-md text-sm leading-relaxed text-black/45">{phase.progression}</p>}
                </div>

                <div className="mt-5 grid gap-4 xl:grid-cols-2">
                  {phase.days.map((day, dayIndex) => (
                    <div key={day.id} className="border border-black/10 bg-[#fbfbf8] p-4">
                      <div className="mb-4 flex items-start justify-between gap-4">
                        <div>
                          <p className="font-medium">{day.title}</p>
                          {day.focus && <p className="mt-1 text-xs text-black/45">{day.focus}</p>}
                        </div>
                        <button
                          type="button"
                          onClick={() => logWorkout(phaseIndex, dayIndex, day.title, day.exercises)}
                          className="border border-black bg-black px-3 py-2 text-xs text-white"
                        >
                          Log workout
                        </button>
                      </div>

                      <div className="space-y-4">
                        {day.exercises.map((exercise) => {
                          const historyKey = exercise.exercise_id ?? exercise.name.toLowerCase();
                          const last = lastWeightByExercise.get(historyKey);
                          return (
                            <div key={exercise.id} className="border border-black/10 bg-white p-4">
                              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                                <div>
                                  <p className="font-medium">{exercise.name}</p>
                                  <p className="mt-1 text-xs text-black/45">
                                    {exercise.sets || '?'} sets · {exercise.reps || '?'} reps · {exercise.rest || 'Rest as needed'}
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
                                {Array.from({ length: parseSets(exercise.sets) }).map((_, setIndex) => {
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
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function parseSets(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}
