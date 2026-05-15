'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Minus, Plus, RefreshCw, Search, X } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { getExerciseBlockValues, requiredWorkoutsForBlock, safeProgramme } from '@/utils/pt/programme';
import { formatBookingDate, formatBookingTime, type PTBookingAppointment } from '@/utils/pt/bookings';
import type {
  PTClient,
  PTExercise,
  PTProgramAssignment,
  PTProgrammeDay,
  PTProgrammeExercise,
  PTProgrammePhase,
  PTProgrammeWeekBlock,
  PTSetLog,
} from '@/utils/pt/types';

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

interface WorkoutSectionView {
  id: string;
  title: string;
  exercises: {
    exercise: PTProgrammeExercise;
    values: ReturnType<typeof getExerciseBlockValues>;
  }[];
}

interface SelectedWorkout {
  phaseIndex: number;
  dayIndex: number;
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
  const parsed = parseInt(value, 10);
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

function getExerciseHistoryKey(exercise: PTProgrammeExercise) {
  return exercise.exercise_id ?? exercise.name.toLowerCase();
}

function formatAppointmentTime(appointment: PTBookingAppointment) {
  const date = new Date(appointment.start_at);
  return `${formatBookingDate(date)} · ${formatBookingTime(date)}`;
}

export default function PTSessionsView({
  initialClients,
  exercises,
  nextAppointment: initialNextAppointment,
}: {
  initialClients: PTClient[];
  exercises: PTExercise[];
  nextAppointment: PTBookingAppointment | null;
}) {
  const supabase = createClient();

  const [clients] = useState<PTClient[]>(initialClients);
  const [nextAppointment, setNextAppointment] = useState<PTBookingAppointment | null>(initialNextAppointment);
  const [selectedClient, setSelectedClient] = useState<PTClient | null>(null);
  const [showClientSelector, setShowClientSelector] = useState(false);
  const [assignment, setAssignment] = useState<PTProgramAssignment | null>(null);
  const [setLogs, setSetLogs] = useState<PTSetLog[]>([]);
  const [workoutLogs, setWorkoutLogs] = useState<WorkoutLog[]>([]);
  const [loadingClient, setLoadingClient] = useState(false);
  const [selectedWorkout, setSelectedWorkout] = useState<SelectedWorkout | null>(null);
  const [setDrafts, setSetDrafts] = useState<Record<string, SetDraft>>({});
  const [setCounts, setSetCounts] = useState<Record<string, number>>({});
  const [doneExercises, setDoneExercises] = useState<Set<string>>(new Set());
  const [exerciseOverrides, setExerciseOverrides] = useState<Record<string, PTProgrammeExercise>>({});
  const [swapTarget, setSwapTarget] = useState<string | null>(null);
  const [swapSearch, setSwapSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  // Auto-select client from next appointment on mount
  useEffect(() => {
    if (initialNextAppointment?.pt_clients) {
      const apptClient = clients.find((c) => c.id === initialNextAppointment.pt_clients!.id);
      if (apptClient) setSelectedClient(apptClient);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadClientData = useCallback(async (clientId: string) => {
    setLoadingClient(true);
    setAssignment(null);
    setSetLogs([]);
    setWorkoutLogs([]);
    setSelectedWorkout(null);
    setSetDrafts({});
    setSetCounts({});
    setDoneExercises(new Set());
    setExerciseOverrides({});

    const [assignmentRes, setLogsRes, workoutLogsRes] = await Promise.all([
      supabase
        .from('pt_program_assignments')
        .select('*')
        .eq('client_id', clientId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1),
      supabase
        .from('pt_set_logs')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('pt_workout_logs')
        .select('id, phase_index, day_index, week_number, block_index, is_quick_done')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false }),
    ]);

    const raw = (assignmentRes.data ?? [])[0];
    if (raw) {
      setAssignment({
        ...raw,
        programme: safeProgramme(raw.programme),
        current_week: raw.current_week ?? 1,
        current_block_index: raw.current_block_index ?? 0,
      } as PTProgramAssignment);
    }
    setSetLogs((setLogsRes.data ?? []) as PTSetLog[]);
    setWorkoutLogs((workoutLogsRes.data ?? []) as WorkoutLog[]);
    setLoadingClient(false);
  }, [supabase]);

  useEffect(() => {
    if (selectedClient) void loadClientData(selectedClient.id);
  }, [selectedClient, loadClientData]);

  const phaseProgress = useMemo(() => {
    if (!assignment) return [];
    return assignment.programme.phases.map((phase, phaseIndex) =>
      calcPhaseProgress(workoutLogs, phaseIndex, phase.week_blocks, phase.days.length),
    );
  }, [assignment, workoutLogs]);

  const lastSetsByExercise = useMemo(() => {
    const map = new Map<string, PTSetLog[]>();
    setLogs.forEach((log) => {
      const key = log.exercise_id ?? log.exercise_name.toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(log);
    });
    return map;
  }, [setLogs]);

  // Pre-fill drafts when a workout is selected
  useEffect(() => {
    if (!selectedWorkout || !assignment) return;
    const phase = assignment.programme.phases[selectedWorkout.phaseIndex];
    const day = phase?.days[selectedWorkout.dayIndex];
    if (!phase || !day) return;
    const progress = phaseProgress[selectedWorkout.phaseIndex];
    const blockIndex = progress?.blockIndex ?? 0;

    const newDrafts: Record<string, SetDraft> = {};
    const newCounts: Record<string, number> = {};

    day.exercises.forEach((exercise) => {
      const effective = exerciseOverrides[exercise.id] ?? exercise;
      const values = getExerciseBlockValues(effective, phase.week_blocks, blockIndex);
      const count = parseSets(values.sets);
      newCounts[exercise.id] = count;

      const histKey = getExerciseHistoryKey(effective);
      const history = lastSetsByExercise.get(histKey) ?? [];

      for (let setIndex = 0; setIndex < count; setIndex++) {
        const key = draftKey(selectedWorkout.phaseIndex, selectedWorkout.dayIndex, exercise.id, setIndex);
        const lastLog = history.find((l) => l.set_number === setIndex + 1);
        newDrafts[key] = {
          reps: lastLog?.reps?.toString() ?? '',
          weight: lastLog?.weight?.toString() ?? '',
        };
      }
    });

    setSetDrafts(newDrafts);
    setSetCounts(newCounts);
    setDoneExercises(new Set());
  // exerciseOverrides intentionally omitted — only re-run when workout selection changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkout, assignment, phaseProgress, lastSetsByExercise]);

  function updateSetDraft(key: string, patch: Partial<SetDraft>) {
    setSetDrafts((prev) => ({ ...prev, [key]: { ...(prev[key] ?? { reps: '', weight: '' }), ...patch } }));
  }

  function setExerciseCount(exerciseId: string, count: number) {
    const next = Math.max(1, count);
    setSetCounts((prev) => ({ ...prev, [exerciseId]: next }));
  }

  function addExerciseSet(exercise: PTProgrammeExercise, currentCount: number) {
    if (!selectedWorkout) return;
    const newCount = currentCount + 1;
    setSetCounts((prev) => ({ ...prev, [exercise.id]: newCount }));
    const effective = exerciseOverrides[exercise.id] ?? exercise;
    const histKey = getExerciseHistoryKey(effective);
    const history = lastSetsByExercise.get(histKey) ?? [];
    const setIndex = newCount - 1;
    const key = draftKey(selectedWorkout.phaseIndex, selectedWorkout.dayIndex, exercise.id, setIndex);
    const lastLog = history.find((l) => l.set_number === setIndex + 1);
    setSetDrafts((prev) => ({
      ...prev,
      [key]: { reps: lastLog?.reps?.toString() ?? '', weight: lastLog?.weight?.toString() ?? '' },
    }));
  }

  function toggleDone(exerciseId: string) {
    setDoneExercises((prev) => {
      const next = new Set(prev);
      if (next.has(exerciseId)) next.delete(exerciseId);
      else next.add(exerciseId);
      return next;
    });
  }

  function swapExercise(originalExerciseId: string, libraryExercise: PTExercise) {
    if (!selectedWorkout || !assignment) return;
    const phase = assignment.programme.phases[selectedWorkout.phaseIndex];
    const blockIndex = phaseProgress[selectedWorkout.phaseIndex]?.blockIndex ?? 0;
    const values = getExerciseBlockValues(
      { id: originalExerciseId, exercise_id: libraryExercise.id, name: libraryExercise.name, sets: '3', reps: '8-12', rest: '', notes: '', video_url: null, cues: [] },
      phase?.week_blocks,
      blockIndex,
    );
    const count = parseSets(values.sets);
    const newExercise: PTProgrammeExercise = {
      id: originalExerciseId,
      exercise_id: libraryExercise.id,
      name: libraryExercise.name,
      sets: values.sets,
      reps: values.reps,
      rest: '',
      notes: libraryExercise.purpose ?? '',
      video_url: libraryExercise.video_url,
      cues: libraryExercise.cues.slice(0, 4),
    };
    setExerciseOverrides((prev) => ({ ...prev, [originalExerciseId]: newExercise }));
    setSetCounts((prev) => ({ ...prev, [originalExerciseId]: count }));

    const histKey = libraryExercise.id ?? libraryExercise.name.toLowerCase();
    const history = lastSetsByExercise.get(histKey) ?? [];
    const newDrafts: Record<string, SetDraft> = {};
    for (let setIndex = 0; setIndex < count; setIndex++) {
      const key = draftKey(selectedWorkout.phaseIndex, selectedWorkout.dayIndex, originalExerciseId, setIndex);
      const lastLog = history.find((l) => l.set_number === setIndex + 1);
      newDrafts[key] = { reps: lastLog?.reps?.toString() ?? '', weight: lastLog?.weight?.toString() ?? '' };
    }
    setSetDrafts((prev) => ({ ...prev, ...newDrafts }));
    setSwapTarget(null);
    setSwapSearch('');
  }

  const handleFinishSession = async () => {
    if (!selectedClient || !assignment || !selectedWorkout) return;
    const phase = assignment.programme.phases[selectedWorkout.phaseIndex];
    const day = phase?.days[selectedWorkout.dayIndex];
    if (!phase || !day) return;

    setSaving(true);
    setStatus('Saving session...');

    const progress = phaseProgress[selectedWorkout.phaseIndex];
    const blockIndex = progress?.blockIndex ?? null;
    const weekWithinBlock = progress?.weekWithinBlock ?? 1;

    const { data: workout, error: workoutError } = await supabase
      .from('pt_workout_logs')
      .insert({
        client_id: selectedClient.id,
        assignment_id: assignment.id,
        phase_index: selectedWorkout.phaseIndex,
        day_index: selectedWorkout.dayIndex,
        week_number: weekWithinBlock,
        block_index: blockIndex,
        workout_title: day.title,
        notes: null,
        is_quick_done: false,
      })
      .select('id')
      .single();

    if (workoutError || !workout) {
      setStatus(workoutError?.message ?? 'Could not save workout.');
      setSaving(false);
      return;
    }

    const workoutId = (workout as { id: string }).id;

    const rows = day.exercises.flatMap((exercise) => {
      const effective = exerciseOverrides[exercise.id] ?? exercise;
      const count = setCounts[exercise.id] ?? 1;
      return Array.from({ length: count }).map((_, setIndex) => {
        const key = draftKey(selectedWorkout.phaseIndex, selectedWorkout.dayIndex, exercise.id, setIndex);
        const draft = setDrafts[key];
        return {
          workout_log_id: workoutId,
          client_id: selectedClient.id,
          assignment_id: assignment.id,
          exercise_id: effective.exercise_id,
          exercise_name: effective.name,
          set_number: setIndex + 1,
          reps: toNullableNumber(draft?.reps),
          weight: toNullableNumber(draft?.weight),
          notes: null,
        };
      });
    });

    if (rows.length > 0) {
      const { error: setError } = await supabase.from('pt_set_logs').insert(rows);
      if (setError) {
        setStatus(setError.message);
        setSaving(false);
        return;
      }
    }

    await supabase.from('pt_events').insert({
      client_id: selectedClient.id,
      assignment_id: assignment.id,
      event_type: 'workout_logged',
      metadata: {
        workout_title: day.title,
        phase_index: selectedWorkout.phaseIndex,
        day_index: selectedWorkout.dayIndex,
        block_index: blockIndex,
        week_number: weekWithinBlock,
        source: 'coach_session',
      },
    });

    // Update programme progression if block advanced
    if (progress && !progress.allBlocksDone) {
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
        phase.week_blocks,
        phase.days.length,
      );
      if (
        newProgress &&
        (newProgress.blockIndex !== progress.blockIndex || newProgress.weekWithinBlock !== progress.weekWithinBlock)
      ) {
        await supabase
          .from('pt_program_assignments')
          .update({ current_block_index: newProgress.blockIndex, current_week: newProgress.weekWithinBlock })
          .eq('id', assignment.id);
      }
    }

    // Deduct session via appointment if linked
    if (nextAppointment && nextAppointment.client_id === selectedClient.id) {
      const { error: bookingError } = await supabase.functions.invoke('manage-pt-booking', {
        body: {
          action: 'complete_appointment',
          appointment_id: nextAppointment.id,
          client_id: selectedClient.id,
        },
      });
      if (bookingError) {
        setStatus('Workout saved. Session deduction failed — mark complete manually in Bookings.');
        setSaving(false);
        return;
      }
    }

    setStatus('Session complete.');
    setSaving(false);
    setSelectedWorkout(null);
    setSetDrafts({});
    setSetCounts({});
    setDoneExercises(new Set());
    setExerciseOverrides({});

    // Reload next appointment and client data
    const apptRes = await supabase
      .from('pt_booking_appointments')
      .select('*, pt_clients(id, name, email, sessions_remaining)')
      .in('status', ['scheduled', 'confirmed'])
      .gt('start_at', new Date().toISOString())
      .order('start_at', { ascending: true })
      .limit(1);
    setNextAppointment((apptRes.data ?? [])[0] ?? null);
    await loadClientData(selectedClient.id);
  };

  const filteredExercises = useMemo(() => {
    if (!swapSearch.trim()) return exercises.slice(0, 30);
    const q = swapSearch.toLowerCase();
    return exercises.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.muscles.some((m) => m.toLowerCase().includes(q)) ||
        (e.tags ?? []).some((t) => t.toLowerCase().includes(q)),
    ).slice(0, 30);
  }, [exercises, swapSearch]);

  // ─── Render: Workout Logger ───────────────────────────────────────────────

  const renderWorkoutLogger = () => {
    if (!selectedWorkout || !assignment || !selectedClient) return null;
    const phase = assignment.programme.phases[selectedWorkout.phaseIndex];
    const day = phase?.days[selectedWorkout.dayIndex];
    if (!phase || !day) return null;

    const progress = phaseProgress[selectedWorkout.phaseIndex];
    const blockIndex = progress?.blockIndex ?? 0;
    const sections = getWorkoutSections(day, phase, blockIndex);
    const totalExercises = day.exercises.length;
    const doneCount = day.exercises.filter((e) => doneExercises.has(e.id)).length;

    return (
      <div className="mx-auto max-w-3xl pb-28">
        <button
          type="button"
          onClick={() => setSelectedWorkout(null)}
          className="mb-5 inline-flex items-center gap-2 text-sm text-black/45 hover:text-black"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to programme
        </button>

        <div className="mb-2">
          <p className="text-[0.65rem] uppercase tracking-[0.18em] text-black/35">{selectedClient.name}</p>
        </div>
        <div className="mb-5 flex items-end justify-between gap-4">
          <h2 className="font-display text-2xl font-light md:text-3xl">{day.title}</h2>
          <span className="text-xs text-black/40">{doneCount}/{totalExercises} done</span>
        </div>

        <div className="space-y-4">
          {sections.map((section) => (
            <section key={section.id} className="border border-black/10 bg-white">
              <div className="border-b border-black/8 px-4 py-3">
                <p className="text-[0.6rem] uppercase tracking-[0.18em] text-black/35">{section.title}</p>
              </div>
              <div className="divide-y divide-black/8">
                {section.exercises.map(({ exercise, values }) => {
                  const effective = exerciseOverrides[exercise.id] ?? exercise;
                  const effectiveValues = exerciseOverrides[exercise.id]
                    ? getExerciseBlockValues(effective, phase.week_blocks, blockIndex)
                    : values;
                  const count = setCounts[exercise.id] ?? parseSets(effectiveValues.sets);
                  const histKey = getExerciseHistoryKey(effective);
                  const history = lastSetsByExercise.get(histKey) ?? [];
                  const isDone = doneExercises.has(exercise.id);
                  const wasSwapped = !!exerciseOverrides[exercise.id];

                  return (
                    <div key={exercise.id} className={`p-4 transition-colors ${isDone ? 'bg-black/[0.02]' : ''}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className={`font-medium ${isDone ? 'text-black/40 line-through' : ''}`}>{effective.name}</p>
                            {wasSwapped && (
                              <span className="text-[0.55rem] uppercase tracking-[0.12em] border border-black/15 bg-black/5 px-1.5 py-0.5 text-black/40">
                                Swapped
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-black/45">
                            Target: {effectiveValues.sets || '?'} sets · {effectiveValues.reps || '?'} reps
                            {effectiveValues.weight_pct ? ` · ${effectiveValues.weight_pct}` : ''}
                          </p>
                          {history.length > 0 && (
                            <p className="mt-0.5 text-xs text-black/30">
                              Last: {history[0]?.weight ?? '-'}kg × {history[0]?.reps ?? '-'}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => { setSwapTarget(exercise.id); setSwapSearch(''); }}
                            className="text-[0.6rem] uppercase tracking-[0.1em] border border-black/15 px-2 py-1 text-black/40 hover:border-black/30 hover:text-black transition-colors"
                          >
                            Swap
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleDone(exercise.id)}
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors ${
                              isDone
                                ? 'border-black bg-black text-white'
                                : 'border-black/20 text-black/30 hover:border-black/50 hover:text-black'
                            }`}
                            aria-label={isDone ? 'Mark undone' : 'Mark done'}
                          >
                            <Check className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      {history.length > 0 && (
                        <div className="mt-3 border border-black/8 bg-[#fbfbf8] px-3 py-2">
                          <p className="text-[0.55rem] uppercase tracking-[0.14em] text-black/30">Last session</p>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {history.slice(0, Math.max(count, history.length)).map((log) => (
                              <span key={`${log.id}-${log.set_number}`} className="border border-black/8 bg-white px-2 py-1 text-xs text-black/45">
                                S{log.set_number}: {log.weight ?? '-'}kg × {log.reps ?? '-'}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="mt-3 space-y-2">
                        {Array.from({ length: count }).map((_, setIndex) => {
                          const key = draftKey(selectedWorkout.phaseIndex, selectedWorkout.dayIndex, exercise.id, setIndex);
                          const draft = setDrafts[key] ?? { reps: '', weight: '' };
                          return (
                            <div key={key} className="grid grid-cols-[3.25rem_1fr_1fr] gap-2">
                              <div className="flex items-center border border-black/10 bg-[#fbfbf8] px-2 text-xs text-black/40">
                                S{setIndex + 1}
                              </div>
                              <input
                                value={draft.weight}
                                onChange={(e) => updateSetDraft(key, { weight: e.target.value })}
                                className="min-w-0 border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-black/35"
                                placeholder="Weight (kg)"
                                inputMode="decimal"
                                disabled={isDone}
                              />
                              <input
                                value={draft.reps}
                                onChange={(e) => updateSetDraft(key, { reps: e.target.value })}
                                className="min-w-0 border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-black/35"
                                placeholder="Reps"
                                inputMode="decimal"
                                disabled={isDone}
                              />
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setExerciseCount(exercise.id, count - 1)}
                          className="inline-flex h-7 w-7 items-center justify-center border border-black/10 text-black/40 hover:border-black/30 hover:text-black disabled:opacity-30"
                          disabled={count <= 1 || isDone}
                          aria-label="Remove set"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => addExerciseSet(exercise, count)}
                          className="inline-flex h-7 w-7 items-center justify-center border border-black/10 text-black/40 hover:border-black/30 hover:text-black disabled:opacity-30"
                          disabled={isDone}
                          aria-label="Add set"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-8 border-t border-black/10 pt-8">
          {status && <p className="mb-4 text-sm text-black/50">{status}</p>}
          <button
            type="button"
            onClick={() => void handleFinishSession()}
            disabled={saving}
            className="w-full border border-black bg-black px-6 py-4 text-sm font-medium uppercase tracking-[0.12em] text-white transition-colors hover:bg-black/85 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Finish Session'}
          </button>
          {nextAppointment?.client_id !== selectedClient.id && (
            <p className="mt-2 text-center text-xs text-black/35">
              No linked appointment — workout will be saved, session count unchanged.
            </p>
          )}
        </div>

        {/* Exercise swap modal */}
        {swapTarget && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
            <div className="w-full max-w-md bg-white">
              <div className="flex items-center justify-between border-b border-black/10 px-4 py-4">
                <p className="font-medium">Swap exercise</p>
                <button type="button" onClick={() => { setSwapTarget(null); setSwapSearch(''); }} className="text-black/40 hover:text-black">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="border-b border-black/10 px-4 py-3">
                <div className="flex items-center gap-2 border border-black/15 bg-[#fbfbf8] px-3 py-2">
                  <Search className="h-4 w-4 shrink-0 text-black/35" />
                  <input
                    autoFocus
                    value={swapSearch}
                    onChange={(e) => setSwapSearch(e.target.value)}
                    placeholder="Search exercises..."
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  />
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-black/8">
                {filteredExercises.length === 0 && (
                  <p className="px-4 py-6 text-sm text-black/40 text-center">No exercises found</p>
                )}
                {filteredExercises.map((ex) => (
                  <button
                    key={ex.id}
                    type="button"
                    onClick={() => swapExercise(swapTarget, ex)}
                    className="w-full px-4 py-3 text-left hover:bg-black/4 transition-colors"
                  >
                    <p className="text-sm font-medium">{ex.name}</p>
                    {ex.muscles.length > 0 && (
                      <p className="mt-0.5 text-xs text-black/40">{ex.muscles.slice(0, 3).join(', ')}</p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ─── Render: Client selector + 3 cards ───────────────────────────────────

  const renderPickView = () => {
    const appointmentClient = nextAppointment?.pt_clients
      ? clients.find((c) => c.id === nextAppointment.pt_clients!.id) ?? null
      : null;

    return (
      <div className="space-y-4">
        {/* Card 1: Next Session */}
        <div className="border border-black/10 bg-white">
          <div className="px-5 py-5">
            <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Next Session</p>
            {nextAppointment ? (
              <div className="mt-2 flex items-center justify-between gap-4">
                <div>
                  <p className="text-lg font-light">{nextAppointment.pt_clients?.name ?? 'Unknown client'}</p>
                  <p className="mt-0.5 text-sm text-black/45">{formatAppointmentTime(nextAppointment)}</p>
                  {nextAppointment.location && (
                    <p className="mt-0.5 text-xs text-black/35">{nextAppointment.location}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowClientSelector((v) => !v)}
                  className="flex shrink-0 items-center gap-1.5 border border-black/15 px-3 py-2 text-xs text-black/50 hover:border-black/30 hover:text-black transition-colors"
                >
                  Change
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showClientSelector ? 'rotate-180' : ''}`} />
                </button>
              </div>
            ) : (
              <div className="mt-2 flex items-center justify-between gap-4">
                <p className="text-sm text-black/45">No upcoming session booked</p>
                <button
                  type="button"
                  onClick={() => setShowClientSelector((v) => !v)}
                  className="flex shrink-0 items-center gap-1.5 border border-black/15 px-3 py-2 text-xs text-black/50 hover:border-black/30 hover:text-black transition-colors"
                >
                  Select client
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showClientSelector ? 'rotate-180' : ''}`} />
                </button>
              </div>
            )}
          </div>

          {(showClientSelector || !nextAppointment) && (
            <div className="border-t border-black/8">
              <div className="max-h-56 overflow-y-auto divide-y divide-black/8">
                {clients.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setSelectedClient(c);
                      setShowClientSelector(false);
                    }}
                    className={`w-full flex items-center justify-between px-5 py-3 text-left text-sm transition-colors hover:bg-black/4 ${
                      selectedClient?.id === c.id ? 'bg-black/5' : ''
                    }`}
                  >
                    <span className={selectedClient?.id === c.id ? 'font-medium' : ''}>{c.name}</span>
                    {c.id === appointmentClient?.id && (
                      <span className="text-[0.55rem] uppercase tracking-[0.12em] border border-black/15 px-1.5 py-0.5 text-black/40">
                        Booked
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Card 2: Selected Client */}
        {selectedClient && (
          <div className="border border-black/10 bg-white px-5 py-5">
            <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Client</p>
            <div className="mt-2 flex items-center justify-between gap-4">
              <p className="text-lg font-light">{selectedClient.name}</p>
              <div className="text-right">
                <p className="text-2xl font-light">{selectedClient.sessions_remaining}</p>
                <p className="text-[0.6rem] uppercase tracking-[0.12em] text-black/35">Sessions left</p>
              </div>
            </div>
            {selectedClient.coaching_focus && (
              <p className="mt-2 text-xs text-black/40">{selectedClient.coaching_focus}</p>
            )}
          </div>
        )}

        {/* Card 3: Workout Programme */}
        {selectedClient && (
          <div className="border border-black/10 bg-white">
            <div className="border-b border-black/8 px-5 py-4">
              <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Workout Programme</p>
            </div>

            {loadingClient ? (
              <div className="flex items-center justify-center px-5 py-10">
                <RefreshCw className="h-5 w-5 animate-spin text-black/30" />
              </div>
            ) : !assignment ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-black/40">No active programme for {selectedClient.name}</p>
              </div>
            ) : (
              <div className="divide-y divide-black/8">
                {assignment.programme.phases.map((phase, phaseIndex) => {
                  const progress = phaseProgress[phaseIndex];
                  return (
                    <div key={phase.id}>
                      <div className="px-5 py-3">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-sm font-medium">{phase.title}</p>
                          <p className="text-xs text-black/35">{phase.focus}</p>
                        </div>
                        {progress && !progress.allBlocksDone && (
                          <p className="mt-0.5 text-xs text-black/35">
                            Block {progress.blockIndex + 1} · Week {progress.weekWithinBlock}
                            {progress.block?.sets ? ` · ${progress.block.sets} sets` : ''}
                          </p>
                        )}
                        {progress?.allBlocksDone && (
                          <span className="mt-1 inline-block text-[0.55rem] uppercase tracking-[0.1em] border border-green-300 bg-green-50 px-1.5 py-0.5 text-green-700">
                            Phase complete
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-px bg-black/8 border-t border-black/8 sm:grid-cols-3">
                        {phase.days.map((day, dayIndex) => {
                          const done = workoutIsDone(workoutLogs, phaseIndex, dayIndex, progress);
                          return (
                            <button
                              key={day.id}
                              type="button"
                              onClick={() => setSelectedWorkout({ phaseIndex, dayIndex })}
                              className={`flex items-center justify-between gap-3 bg-white px-4 py-4 text-left transition-colors hover:bg-black/4 ${done ? 'opacity-50' : ''}`}
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-medium truncate">{day.title}</p>
                                <p className="mt-0.5 text-[0.6rem] text-black/40 truncate">{day.focus}</p>
                                <p className="mt-1 text-[0.6rem] text-black/30">
                                  {day.exercises.length} exercise{day.exercises.length !== 1 ? 's' : ''}
                                </p>
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-1">
                                {done && <Check className="h-4 w-4 text-black/35" />}
                                <ChevronRight className="h-4 w-4 text-black/25" />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ─── Main render ─────────────────────────────────────────────────────────

  return (
    <div className="px-5 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-1">PT</p>
      <h1 className="font-display text-3xl font-light tracking-[-0.02em] mb-8">PT Sessions</h1>

      <div className="mx-auto max-w-3xl">
        {selectedWorkout ? renderWorkoutLogger() : renderPickView()}
      </div>
    </div>
  );
}
