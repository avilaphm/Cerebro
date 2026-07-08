'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronLeft, ChevronRight, Minus, Plus, RefreshCw, Search, X } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import {
  calcPhaseProgress,
  getCursorUpdateAfterWorkout,
  getExerciseBlockValues,
  getExerciseForBlock,
  resolveActivePhaseIndex,
  safeProgramme,
  type PhaseProgress,
} from '@/utils/pt/programme';
import { derivePattern } from '@/utils/pt/patterns';
import { formatBookingDate, formatBookingTime, type PTBookingAppointment } from '@/utils/pt/bookings';
import type {
  PTClient,
  PTExercise,
  PTProgramAssignment,
  PTProgrammeDay,
  PTProgrammeExercise,
  PTProgrammePhase,
  PTSetLog,
} from '@/utils/pt/types';

function getYouTubeId(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu.be')) return parsed.pathname.split('/').filter(Boolean)[0] ?? null;
    if (parsed.pathname.startsWith('/shorts/')) return parsed.pathname.split('/')[2] ?? null;
    if (parsed.pathname.startsWith('/embed/')) return parsed.pathname.split('/')[2] ?? null;
    return parsed.searchParams.get('v');
  } catch {
    const match = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{6,})/);
    return match?.[1] ?? null;
  }
}

interface SetDraft { reps: string; weight: string; }

interface WorkoutLog {
  id: string;
  phase_index: number;
  day_index: number;
  week_number: number;
  block_index: number | null;
  is_quick_done: boolean;
  created_at: string;
}

interface WorkoutSectionView {
  id: string;
  title: string;
  exercises: { exercise: PTProgrammeExercise; values: ReturnType<typeof getExerciseBlockValues>; }[];
}

interface SelectedWorkout { phaseIndex: number; dayIndex: number; }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseSets(value: string) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function toNullableNumber(value: string | undefined) {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function draftKey(phaseIndex: number, dayIndex: number, exerciseId: string, setIndex: number) {
  return `${phaseIndex}-${dayIndex}-${exerciseId}-${setIndex}`;
}

function parseDraftKey(key: string): { prefix: string; exerciseId: string; setIndex: number } | null {
  const parts = key.split('-');
  if (parts.length < 4) return null;
  const setIndex = Number(parts[parts.length - 1]);
  if (!Number.isInteger(setIndex)) return null;
  const exerciseId = parts.slice(2, -1).join('-');
  return { prefix: `${parts[0]}-${parts[1]}-${exerciseId}-`, exerciseId, setIndex };
}

function getWorkoutSections(day: PTProgrammeDay, phase: PTProgrammePhase, blockIndex: number): WorkoutSectionView[] {
  const sections: WorkoutSectionView[] = [];
  day.exercises.forEach((exercise, index) => {
    const title = exercise.section_start?.trim() || (sections.length === 0 ? 'Main work' : '');
    if (index === 0 || exercise.section_start || sections.length === 0) {
      sections.push({ id: `${index}-${title || 'section'}`, title: title || 'Main work', exercises: [] });
    }
    const blockExercise = getExerciseForBlock(exercise, blockIndex);
    sections[sections.length - 1].exercises.push({
      exercise: blockExercise,
      values: getExerciseBlockValues(blockExercise, phase.week_blocks, blockIndex),
    });
  });
  return sections;
}

function workoutIsDone(logs: WorkoutLog[], phaseIndex: number, dayIndex: number, progress: PhaseProgress | null) {
  if (!progress) return logs.some((l) => l.phase_index === phaseIndex && l.day_index === dayIndex);
  return logs.some((l) =>
    l.phase_index === phaseIndex && l.day_index === dayIndex &&
    l.block_index === progress.blockIndex && l.week_number === progress.weekWithinBlock,
  );
}

function getWorkoutCompletedAt(logs: WorkoutLog[], phaseIndex: number, dayIndex: number, progress: PhaseProgress | null): string | null {
  const log = progress
    ? logs.find((l) => l.phase_index === phaseIndex && l.day_index === dayIndex && l.block_index === progress.blockIndex && l.week_number === progress.weekWithinBlock)
    : logs.find((l) => l.phase_index === phaseIndex && l.day_index === dayIndex);
  return log?.created_at ?? null;
}

function getExerciseHistoryKey(exercise: PTProgrammeExercise) {
  return exercise.exercise_id ?? exercise.name.toLowerCase();
}

interface ExerciseSession { id: string; date: string; sets: PTSetLog[]; }

function formatHistoryDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

// The Big-5 lifts Pedro tests for 1RM. Used to auto-calc a target weight from %.
type LiftKey = 'squat' | 'deadlift' | 'bench' | 'pulldown' | 'pullup' | 'shoulderpress';

function liftCategory(name: string): LiftKey | null {
  const n = name.toLowerCase();
  if (/pull\s*-?\s*down|pulldown|lat\s*pull/.test(n)) return 'pulldown';
  if (/pull\s*-?\s*ups?|pullups?|chin\s*-?\s*ups?/.test(n)) return 'pullup';
  if (/shoulder\s*press|overhead\s*press|\bohp\b/.test(n)) return 'shoulderpress';
  if (/squat/.test(n)) return 'squat';
  if (/dead\s*-?\s*lift/.test(n)) return 'deadlift';
  if (/bench/.test(n)) return 'bench';
  return null;
}

// Only the barbell/cable MAIN lifts carry a %1RM target — accessories that share
// a keyword (Cossack Squat, RDL, DB Bench, Pallof Press, ...) must not.
const ACCESSORY_QUALIFIER = /cossack|goblet|split|bulgarian|hack|sissy|pause|box|wall|sumo|single|b-?stance|romanian|\brdl\b|stiff|trap[\s-]?bar|deficit|good\s*morning|\bdb\b|dumbbell|machine|cable|smith|incline|decline|close[\s-]?grip|landmine|arnold|lateral|half\s*kneeling|seated|bodyweight|\bpin\b|floor|pallof/;

function isMainLift(name: string): boolean {
  const n = name.toLowerCase();
  if (/lat\s*pull\s*-?\s*down|lat\s*pulldown/.test(n)) return true;
  if (ACCESSORY_QUALIFIER.test(n)) return false;
  if (/squat/.test(n)) return true;
  if (/dead\s*-?\s*lift/.test(n)) return true;
  if (/bench\s*press/.test(n)) return true;
  if (/shoulder\s*press|overhead\s*press|\bohp\b/.test(n)) return true;
  return false;
}

function parsePct(value?: string | null): number | null {
  if (!value) return null;
  const match = value.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const n = parseFloat(match[1]);
  return Number.isFinite(n) ? n : null;
}

interface OneRMResult { exercise_id: string | null; exercise_name: string; load_kg: number | null; estimated_1rm_kg: number | null; created_at: string; }

function applyExerciseOverridesToProgramme(
  assignment: PTProgramAssignment,
  selectedWorkout: SelectedWorkout,
  overrides: Record<string, PTProgrammeExercise>,
): { programme: PTProgramAssignment['programme']; changed: boolean; swapped: Array<{ from: string; to: string }> } {
  const overrideEntries = Object.entries(overrides);
  if (overrideEntries.length === 0) {
    return { programme: assignment.programme, changed: false, swapped: [] };
  }

  const programme = structuredClone(assignment.programme);
  const day = programme.phases[selectedWorkout.phaseIndex]?.days[selectedWorkout.dayIndex];
  if (!day) return { programme: assignment.programme, changed: false, swapped: [] };

  const swapped: Array<{ from: string; to: string }> = [];
  day.exercises = day.exercises.map((exercise) => {
    const override = overrides[exercise.id];
    if (!override) return exercise;
    swapped.push({ from: exercise.name, to: override.name });
    return {
      ...exercise,
      exercise_id: override.exercise_id,
      name: override.name,
      notes: override.notes,
      video_url: override.video_url,
      cues: override.cues,
      pattern: override.pattern ?? exercise.pattern ?? null,
    };
  });

  return { programme, changed: swapped.length > 0, swapped };
}

function isToday(isoString: string) {
  const d = new Date(isoString);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

function isTomorrow(isoString: string) {
  const d = new Date(isoString);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return d.toDateString() === tomorrow.toDateString();
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PTSessionsView({
  initialClients,
  exercises,
  initialAppointments,
}: {
  initialClients: PTClient[];
  exercises: PTExercise[];
  initialAppointments: PTBookingAppointment[];
}) {
  const supabase = createClient();
  const topRef = useRef<HTMLDivElement>(null);

  const [clients] = useState<PTClient[]>(initialClients);
  const [appointments, setAppointments] = useState<PTBookingAppointment[]>(initialAppointments);
  const [selectedClient, setSelectedClient] = useState<PTClient | null>(null);
  const [showClientSelector, setShowClientSelector] = useState(false);
  const [assignment, setAssignment] = useState<PTProgramAssignment | null>(null);
  const [setLogs, setSetLogs] = useState<PTSetLog[]>([]);
  const [workoutLogs, setWorkoutLogs] = useState<WorkoutLog[]>([]);
  const [oneRMResults, setOneRMResults] = useState<OneRMResult[]>([]);
  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(new Set());
  const [loadingClient, setLoadingClient] = useState(false);
  const [selectedWorkout, setSelectedWorkout] = useState<SelectedWorkout | null>(null);
  const [setDrafts, setSetDrafts] = useState<Record<string, SetDraft>>({});
  const [setCounts, setSetCounts] = useState<Record<string, number>>({});
  const [doneExercises, setDoneExercises] = useState<Set<string>>(new Set());
  const [exerciseOverrides, setExerciseOverrides] = useState<Record<string, PTProgrammeExercise>>({});
  const [libExercises, setLibExercises] = useState<PTExercise[]>(exercises);
  const [swapTarget, setSwapTarget] = useState<string | null>(null);
  const [swapSearch, setSwapSearch] = useState('');
  const [creatingExercise, setCreatingExercise] = useState(false);
  const [newExName, setNewExName] = useState('');
  const [newExVideo, setNewExVideo] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [noShowBusy, setNoShowBusy] = useState(false);
  const [noShowStatus, setNoShowStatus] = useState('');

  // Next appointment: first one today (regardless of time), else first future one
  const nextAppointment = useMemo(() => {
    const todayFirst = appointments.find((a) => isToday(a.start_at));
    return todayFirst ?? appointments[0] ?? null;
  }, [appointments]);

  const hasMoreToday = useMemo(() => {
    const todays = appointments.filter((a) => isToday(a.start_at));
    return todays.length > 1;
  }, [appointments]);

  // First upcoming appointment for the currently selected client (regardless of who nextAppointment is for)
  const selectedClientNextAppt = useMemo(() => {
    if (!selectedClient) return null;
    return appointments.find((a) => a.client_id === selectedClient.id) ?? null;
  }, [appointments, selectedClient]);

  const refreshAppointments = useCallback(async () => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const res = await supabase
      .from('pt_booking_appointments')
      .select('*, pt_clients(id, name, email, sessions_remaining)')
      .in('status', ['scheduled', 'confirmed'])
      .gte('start_at', todayStart.toISOString())
      .order('start_at', { ascending: true })
      .limit(10);
    setAppointments((res.data ?? []) as PTBookingAppointment[]);
  }, [supabase]);

  // Auto-select client from next appointment
  useEffect(() => {
    if (nextAppointment?.pt_clients) {
      const match = clients.find((c) => c.id === nextAppointment.pt_clients!.id);
      if (match) setSelectedClient(match);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadClientData = useCallback(async (clientId: string) => {
    setLoadingClient(true);
    setAssignment(null);
    setSetLogs([]);
    setWorkoutLogs([]);
    setOneRMResults([]);
    setExpandedHistory(new Set());
    setSelectedWorkout(null);
    setSetDrafts({});
    setSetCounts({});
    setDoneExercises(new Set());
    setExerciseOverrides({});

    const [assignmentRes, setLogsRes, workoutLogsRes, oneRMRes] = await Promise.all([
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
        .select('id, phase_index, day_index, week_number, block_index, is_quick_done, created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false }),
      supabase
        .from('pt_client_1rm_results')
        .select('exercise_id, exercise_name, load_kg, estimated_1rm_kg, created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false }),
    ]);

    const raw = (assignmentRes.data ?? [])[0];
    if (raw) {
      setAssignment({
        ...raw,
        programme: safeProgramme(raw.programme),
        current_phase_index: typeof raw.current_phase_index === 'number' ? raw.current_phase_index : null,
        current_week: raw.current_week ?? 1,
        current_block_index: raw.current_block_index ?? 0,
      } as PTProgramAssignment);
    }
    setSetLogs((setLogsRes.data ?? []) as PTSetLog[]);
    setWorkoutLogs((workoutLogsRes.data ?? []) as WorkoutLog[]);
    setOneRMResults((oneRMRes.data ?? []) as OneRMResult[]);
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

  // Active phase: first phase that's not complete, or last phase
  const activePhaseIndex = useMemo(() => {
    if (!assignment) return 0;
    return resolveActivePhaseIndex(assignment.programme, workoutLogs, assignment.current_phase_index);
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

  // Sets grouped into past sessions (newest first), each session's sets sorted S1..Sn.
  const sessionsByExercise = useMemo(() => {
    const grouped = new Map<string, Map<string, PTSetLog[]>>();
    setLogs.forEach((log) => {
      const key = log.exercise_id ?? log.exercise_name.toLowerCase();
      const sessionKey = log.workout_log_id ?? log.created_at;
      if (!grouped.has(key)) grouped.set(key, new Map());
      const inner = grouped.get(key)!;
      if (!inner.has(sessionKey)) inner.set(sessionKey, []);
      inner.get(sessionKey)!.push(log);
    });
    const result = new Map<string, ExerciseSession[]>();
    grouped.forEach((inner, key) => {
      const sessions: ExerciseSession[] = [];
      inner.forEach((sets, sessionKey) => {
        const sorted = [...sets].sort((a, b) => a.set_number - b.set_number);
        sessions.push({ id: sessionKey, date: sorted[0].created_at, sets: sorted });
      });
      sessions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      result.set(key, sessions);
    });
    return result;
  }, [setLogs]);

  // Best achieved load per Big-5 lift, used to auto-calc target weights from %.
  // Pedro logs 1RM testing as a normal workout, so the heaviest set logged for a
  // lift is the 1RM. We take the max across both the formal 1RM panel and set logs.
  const bestOneRMByLift = useMemo(() => {
    const map = new Map<LiftKey, number>();
    const consider = (name: string, val: number | null | undefined) => {
      const cat = liftCategory(name);
      if (!cat || val == null) return;
      const current = map.get(cat);
      if (current == null || val > current) map.set(cat, val);
    };
    oneRMResults.forEach((r) => consider(r.exercise_name, r.load_kg ?? r.estimated_1rm_kg));
    setLogs.forEach((log) => consider(log.exercise_name, log.weight));
    return map;
  }, [oneRMResults, setLogs]);

  const computeTargetWeight = useCallback((exerciseName: string, weightPct?: string | null): number | null => {
    const cat = liftCategory(exerciseName);
    if (!cat) return null;
    const pct = parsePct(weightPct);
    if (pct == null) return null;
    const best = bestOneRMByLift.get(cat);
    if (best == null) return null;
    return Math.round((best * (pct / 100)) / 2.5) * 2.5;
  }, [bestOneRMByLift]);

  function toggleHistory(exerciseId: string) {
    setExpandedHistory((prev) => {
      const next = new Set(prev);
      if (next.has(exerciseId)) next.delete(exerciseId); else next.add(exerciseId);
      return next;
    });
  }

  // Pre-fill drafts when workout is selected
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

      // Fall back to the lower-bound of target reps (e.g. "8-12" → "8", "10" → "10")
      const targetRepsNum = parseInt(values.reps, 10);
      const defaultReps = Number.isFinite(targetRepsNum) ? targetRepsNum.toString() : '';

      const history = lastSetsByExercise.get(getExerciseHistoryKey(effective)) ?? [];
      for (let si = 0; si < count; si++) {
        const key = draftKey(selectedWorkout.phaseIndex, selectedWorkout.dayIndex, exercise.id, si);
        const last = history.find((l) => l.set_number === si + 1);
        newDrafts[key] = {
          reps: last?.reps?.toString() ?? defaultReps,
          weight: last?.weight?.toString() ?? '',
        };
      }
    });

    setSetDrafts(newDrafts);
    setSetCounts(newCounts);
    setDoneExercises(new Set());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkout, assignment, phaseProgress, lastSetsByExercise]);

  function updateSetDraft(key: string, patch: Partial<SetDraft>) {
    setSetDrafts((prev) => {
      const current = prev[key] ?? { reps: '', weight: '' };
      const next: Record<string, SetDraft> = { ...prev, [key]: { ...current, ...patch } };

      if (patch.weight !== undefined) {
        const parsed = parseDraftKey(key);
        const nextWeight = patch.weight.trim();
        const previousWeight = current.weight.trim();
        const count = parsed ? setCounts[parsed.exerciseId] ?? 0 : 0;
        if (parsed && nextWeight) {
          for (let i = parsed.setIndex + 1; i < count; i++) {
            const laterKey = `${parsed.prefix}${i}`;
            const later = next[laterKey] ?? { reps: '', weight: '' };
            const laterWeight = later.weight.trim();
            if (!laterWeight || (previousWeight && laterWeight === previousWeight)) {
              next[laterKey] = { ...later, weight: patch.weight };
            }
          }
        }
      }

      return next;
    });
  }

  function setExerciseCount(exerciseId: string, count: number) {
    setSetCounts((prev) => ({ ...prev, [exerciseId]: Math.max(1, count) }));
  }

  function addExerciseSet(exercise: PTProgrammeExercise, currentCount: number) {
    if (!selectedWorkout || !assignment) return;
    const newCount = currentCount + 1;
    setSetCounts((prev) => ({ ...prev, [exercise.id]: newCount }));
    const effective = exerciseOverrides[exercise.id] ?? exercise;
    const phase = assignment.programme.phases[selectedWorkout.phaseIndex];
    const blockIndex = phaseProgress[selectedWorkout.phaseIndex]?.blockIndex ?? 0;
    const values = getExerciseBlockValues(effective, phase?.week_blocks, blockIndex);
    const targetRepsNum = parseInt(values.reps, 10);
    const defaultReps = Number.isFinite(targetRepsNum) ? targetRepsNum.toString() : '';
    const history = lastSetsByExercise.get(getExerciseHistoryKey(effective)) ?? [];
    const key = draftKey(selectedWorkout.phaseIndex, selectedWorkout.dayIndex, exercise.id, newCount - 1);
    const last = history.find((l) => l.set_number === newCount);
    setSetDrafts((prev) => {
      const previousKey = draftKey(selectedWorkout.phaseIndex, selectedWorkout.dayIndex, exercise.id, newCount - 2);
      const previousWeight = prev[previousKey]?.weight?.trim();
      return {
        ...prev,
        [key]: {
          reps: last?.reps?.toString() ?? defaultReps,
          weight: last?.weight?.toString() ?? previousWeight ?? '',
        },
      };
    });
  }

  function toggleDone(exerciseId: string) {
    setDoneExercises((prev) => {
      const next = new Set(prev);
      if (next.has(exerciseId)) next.delete(exerciseId); else next.add(exerciseId);
      return next;
    });
  }

  function swapExercise(originalId: string, lib: PTExercise) {
    if (!selectedWorkout || !assignment) return;
    const phase = assignment.programme.phases[selectedWorkout.phaseIndex];
    const original = phase?.days[selectedWorkout.dayIndex]?.exercises.find((exercise) => exercise.id === originalId);
    if (!phase || !original) return;
    const blockIndex = phaseProgress[selectedWorkout.phaseIndex]?.blockIndex ?? 0;
    const existingValues = getExerciseBlockValues(original, phase.week_blocks, blockIndex);
    const count = parseSets(existingValues.sets);
    const newExercise: PTProgrammeExercise = {
      ...original,
      exercise_id: lib.id,
      name: lib.name,
      sets: original.sets,
      reps: original.reps,
      rest: original.rest,
      notes: lib.purpose ?? '',
      video_url: lib.video_url, cues: lib.cues.slice(0, 4),
      pattern: derivePattern(lib.name, lib.tags),
    };
    setExerciseOverrides((prev) => ({ ...prev, [originalId]: newExercise }));
    setSetCounts((prev) => ({ ...prev, [originalId]: count }));
    const history = lastSetsByExercise.get(lib.id ?? lib.name.toLowerCase()) ?? [];
    const targetRepsNum = parseInt(existingValues.reps, 10);
    const defaultReps = Number.isFinite(targetRepsNum) ? targetRepsNum.toString() : '';
    const newDrafts: Record<string, SetDraft> = {};
    for (let si = 0; si < count; si++) {
      const key = draftKey(selectedWorkout.phaseIndex, selectedWorkout.dayIndex, originalId, si);
      const last = history.find((l) => l.set_number === si + 1);
      newDrafts[key] = { reps: last?.reps?.toString() ?? defaultReps, weight: last?.weight?.toString() ?? '' };
    }
    setSetDrafts((prev) => ({ ...prev, ...newDrafts }));
    closeSwap();
  }

  function closeSwap() {
    setSwapTarget(null);
    setSwapSearch('');
    setCreatingExercise(false);
    setNewExName('');
    setNewExVideo('');
    setCreateError('');
  }

  async function createAndSwapExercise() {
    if (!swapTarget) return;
    const name = newExName.trim();
    if (!name) { setCreateError('Give the exercise a name.'); return; }
    const video = newExVideo.trim();
    if (video && !getYouTubeId(video)) { setCreateError('That does not look like a YouTube link.'); return; }

    setCreateBusy(true);
    setCreateError('');
    const { data, error } = await supabase
      .from('pt_exercises')
      .insert({ name, video_url: video || null, source: 'manual' })
      .select('*')
      .single();

    if (error || !data) {
      setCreateError(error?.message ?? 'Could not create the exercise.');
      setCreateBusy(false);
      return;
    }

    const created = data as PTExercise;
    setLibExercises((prev) => [created, ...prev].sort((a, b) => a.name.localeCompare(b.name)));
    setCreateBusy(false);
    swapExercise(swapTarget, created);
  }

  const handleNoShow = async () => {
    const linkedAppt = selectedClientNextAppt;
    if (!linkedAppt || !selectedClient) return;
    setNoShowBusy(true);
    setNoShowStatus('');
    const { data, error } = await supabase.functions.invoke<{ error?: string; sessions_remaining?: number }>('manage-pt-booking', {
      body: { action: 'no_show', appointment_id: linkedAppt.id },
    });
    if (error || data?.error) {
      setNoShowStatus(data?.error ?? error?.message ?? 'Could not mark no show.');
      setNoShowBusy(false);
      return;
    }
    setNoShowStatus('');
    setNoShowBusy(false);
    await Promise.all([refreshAppointments(), loadClientData(selectedClient.id)]);
  };

  const handleFinishSession = async () => {
    if (!selectedClient || !assignment || !selectedWorkout) return;
    const phase = assignment.programme.phases[selectedWorkout.phaseIndex];
    const day = phase?.days[selectedWorkout.dayIndex];
    if (!phase || !day) return;

    setSaving(true);
    setStatus(Object.keys(exerciseOverrides).length > 0 ? 'Saving session and programme swaps...' : 'Saving session...');

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

    const blockIndexForSave = phaseProgress[selectedWorkout.phaseIndex]?.blockIndex ?? 0;

    const rows = day.exercises.flatMap((exercise) => {
      const effective = exerciseOverrides[exercise.id] ?? exercise;
      const count = setCounts[exercise.id] ?? 1;
      const values = getExerciseBlockValues(effective, phase.week_blocks, blockIndexForSave);
      const targetRepsNum = parseInt(values.reps, 10);
      const targetRepsFallback = Number.isFinite(targetRepsNum) ? targetRepsNum : null;

      return Array.from({ length: count }).map((_, si) => {
        const key = draftKey(selectedWorkout.phaseIndex, selectedWorkout.dayIndex, exercise.id, si);
        const draft = setDrafts[key];
        return {
          workout_log_id: workoutId,
          client_id: selectedClient.id,
          assignment_id: assignment.id,
          exercise_id: effective.exercise_id,
          exercise_name: effective.name,
          set_number: si + 1,
          reps: toNullableNumber(draft?.reps) ?? targetRepsFallback,
          weight: toNullableNumber(draft?.weight),
          notes: null,
        };
      });
    });

    if (rows.length > 0) {
      const { error: setError } = await supabase.from('pt_set_logs').insert(rows);
      if (setError) { setStatus(setError.message); setSaving(false); return; }
    }

    await supabase.from('pt_events').insert({
      client_id: selectedClient.id,
      assignment_id: assignment.id,
      event_type: 'workout_logged',
      metadata: {
        workout_log_id: workoutId,
        workout_title: day.title,
        phase_index: selectedWorkout.phaseIndex,
        day_index: selectedWorkout.dayIndex,
        block_index: blockIndex,
        week_number: weekWithinBlock,
        source: 'coach_session',
      },
    });

    void supabase.functions
      .invoke('classify-exercise-library', {
        body: { client_id: selectedClient.id, workout_log_id: workoutId },
      })
      .then((result) => {
        const payload = result.data as { ok?: boolean; error?: string } | null;
        if (result.error || payload?.ok === false) {
          console.warn('Exercise classification queued with errors', result.error?.message ?? payload?.error);
        }
      })
      .catch((error: unknown) => {
        console.warn('Exercise classification request failed', error);
      })
      .finally(() => {
        void supabase.functions
          .invoke('compute-client-tonnage', {
            body: { client_id: selectedClient.id },
          })
          .catch((error: unknown) => {
            console.warn('Tonnage recompute request failed', error);
          });
      });

    const sessionSummary = rows
      .map((row) =>
        `${row.exercise_name} set ${row.set_number}: ${row.weight ?? '-'}kg x ${row.reps ?? '-'} reps`,
      )
      .join('; ');

    void supabase.functions.invoke('update-client-brain', {
      body: {
        client_id: selectedClient.id,
        trigger_type: 'workout_logged',
        content: `Coach logged ${day.title} for ${selectedClient.name}. ${sessionSummary || 'No set details recorded.'}`,
        structured_data: {
          source: 'pt_sessions',
          workout_log_id: workoutId,
          assignment_id: assignment.id,
          programme_name: assignment.name,
          workout_title: day.title,
          phase_index: selectedWorkout.phaseIndex,
          day_index: selectedWorkout.dayIndex,
          block_index: blockIndex,
          week_number: weekWithinBlock,
          sets: rows,
        },
      },
    });

    const updatedLogs: WorkoutLog[] = [
      ...workoutLogs,
      { id: workoutId, phase_index: selectedWorkout.phaseIndex, day_index: selectedWorkout.dayIndex,
        week_number: weekWithinBlock, block_index: blockIndex, is_quick_done: false, created_at: new Date().toISOString() },
    ];
    const swapSync = applyExerciseOverridesToProgramme(assignment, selectedWorkout, exerciseOverrides);
    const cursor = getCursorUpdateAfterWorkout(swapSync.programme, updatedLogs, selectedWorkout.phaseIndex);
    const cursorChanged = Boolean(
      cursor &&
      (
        cursor.phaseIndex !== (assignment.current_phase_index ?? null) ||
        cursor.blockIndex !== assignment.current_block_index ||
        cursor.week !== assignment.current_week
      ),
    );

    if (swapSync.changed || cursorChanged) {
      const assignmentPatch: Partial<PTProgramAssignment> = {};
      if (swapSync.changed) assignmentPatch.programme = swapSync.programme;
      if (cursor) {
        assignmentPatch.current_phase_index = cursor.phaseIndex;
        assignmentPatch.current_block_index = cursor.blockIndex;
        assignmentPatch.current_week = cursor.week;
      }

      const { error: assignmentError } = await supabase
        .from('pt_program_assignments')
        .update(assignmentPatch)
        .eq('id', assignment.id);

      if (assignmentError) {
        setStatus(`Workout saved, but programme update failed: ${assignmentError.message}`);
        setSaving(false);
        return;
      }

      if (swapSync.changed) {
        await supabase.from('pt_events').insert({
          client_id: selectedClient.id,
          assignment_id: assignment.id,
          event_type: 'programme_exercise_swapped',
          metadata: {
            source: 'pt_sessions_finish',
            workout_log_id: workoutId,
            phase_index: selectedWorkout.phaseIndex,
            day_index: selectedWorkout.dayIndex,
            swaps: swapSync.swapped,
          },
        });
      }
    }

    // Deduct session credit
    const linkedAppt = selectedClientNextAppt;
    if (linkedAppt) {
      // Booking-linked session: use manage-pt-booking to complete the appointment and deduct
      const { data: apptData, error: apptError } = await supabase.functions.invoke<{ error?: string }>('manage-pt-booking', {
        body: { action: 'complete', appointment_id: linkedAppt.id },
      });
      if (apptError || apptData?.error) {
        setStatus(`Workout saved. Session deduction failed: ${apptData?.error ?? apptError?.message ?? 'unknown error'}`);
        setSaving(false);
        return;
      }
    } else {
      // No booking — deduct directly from the client's session pack
      const currentBalance = selectedClient.sessions_remaining ?? 0;
      const nextBalance = Math.max(0, currentBalance - 1);
      await supabase
        .from('pt_clients')
        .update({ sessions_remaining: nextBalance, updated_at: new Date().toISOString() })
        .eq('id', selectedClient.id);
      await supabase.from('pt_session_ledger').insert({
        client_id: selectedClient.id,
        appointment_id: null,
        entry_type: 'session_completed',
        quantity: -1,
        balance_after: nextBalance,
        notes: `Session tracked: ${day.title}`,
      });
    }

    // Reset and scroll to top
    setSaving(false);
    setStatus('');
    setSelectedWorkout(null);
    setSetDrafts({});
    setSetCounts({});
    setDoneExercises(new Set());
    setExerciseOverrides({});

    await Promise.all([refreshAppointments(), loadClientData(selectedClient.id)]);

    topRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const filteredExercises = useMemo(() => {
    if (!swapSearch.trim()) return libExercises.slice(0, 30);
    const q = swapSearch.toLowerCase();
    return libExercises.filter((e) =>
      e.name.toLowerCase().includes(q) ||
      e.muscles.some((m) => m.toLowerCase().includes(q)) ||
      (e.tags ?? []).some((t) => t.toLowerCase().includes(q)),
    ).slice(0, 30);
  }, [libExercises, swapSearch]);

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

        <div className="mb-1">
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
                  const sessions = sessionsByExercise.get(getExerciseHistoryKey(effective)) ?? [];
                  const historyExpanded = expandedHistory.has(exercise.id);
                  const shownSessions = historyExpanded ? sessions.slice(0, 3) : sessions.slice(0, 1);
                  const targetWeight = isMainLift(effective.name)
                    ? computeTargetWeight(effective.name, effectiveValues.weight_pct)
                    : null;
                  const isDone = doneExercises.has(exercise.id);
                  const wasSwapped = !!exerciseOverrides[exercise.id];

                  return (
                    <div key={exercise.id} className={`p-4 transition-colors ${isDone ? 'bg-black/[0.02]' : ''}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
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
                            {targetWeight != null && (
                              <span className="font-semibold text-black"> → {targetWeight}kg</span>
                            )}
                          </p>
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
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                              isDone
                                ? 'border-black bg-black text-white'
                                : 'border-black/40 text-black/55 hover:border-black hover:text-black'
                            }`}
                            aria-label={isDone ? 'Mark undone' : 'Mark done'}
                          >
                            <Check className="h-5 w-5" strokeWidth={2.5} />
                          </button>
                        </div>
                      </div>

                      {sessions.length > 0 && (
                        <div className="mt-3 border border-black/8 bg-[#fbfbf8]">
                          <button
                            type="button"
                            onClick={() => toggleHistory(exercise.id)}
                            className="flex w-full items-center justify-between px-3 py-2.5"
                          >
                            <span className="text-[0.55rem] uppercase tracking-[0.14em] text-black/40">
                              {historyExpanded ? `Last ${shownSessions.length} sessions` : 'Last session'}
                            </span>
                            {sessions.length > 1 && (
                              <ChevronDown className={`h-4 w-4 text-black/40 transition-transform ${historyExpanded ? 'rotate-180' : ''}`} />
                            )}
                          </button>
                          <div className="space-y-2.5 px-3 pb-3">
                            {shownSessions.map((session) => (
                              <div key={session.id}>
                                {historyExpanded && (
                                  <p className="mb-1 text-[0.55rem] uppercase tracking-[0.12em] text-black/30">
                                    {formatHistoryDate(session.date)}
                                  </p>
                                )}
                                <div className="flex flex-wrap gap-1">
                                  {session.sets.map((log) => (
                                    <span key={`${log.id}-${log.set_number}`} className="border border-black/8 bg-white px-2 py-1 text-xs text-black/55">
                                      S{log.set_number}: {log.weight ?? '-'}kg × {log.reps ?? '-'}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="mt-3 space-y-2">
                        {Array.from({ length: count }).map((_, si) => {
                          const key = draftKey(selectedWorkout.phaseIndex, selectedWorkout.dayIndex, exercise.id, si);
                          const draft = setDrafts[key] ?? { reps: '', weight: '' };
                          return (
                            <div key={key} className="grid grid-cols-[3.25rem_1fr_1fr] gap-2">
                              <div className="flex items-center border border-black/10 bg-[#fbfbf8] px-2 text-xs text-black/40">
                                S{si + 1}
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

                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setExerciseCount(exercise.id, count - 1)}
                          className="inline-flex items-center gap-1.5 border border-black/20 px-3 py-2 text-xs font-medium text-black/60 hover:border-black hover:text-black disabled:opacity-30"
                          disabled={count <= 1 || isDone}
                        >
                          <Minus className="h-4 w-4" strokeWidth={2.5} />
                          Remove set
                        </button>
                        <button
                          type="button"
                          onClick={() => addExerciseSet(exercise, count)}
                          className="inline-flex items-center gap-1.5 border border-black/20 px-3 py-2 text-xs font-medium text-black/60 hover:border-black hover:text-black disabled:opacity-30"
                          disabled={isDone}
                        >
                          <Plus className="h-4 w-4" strokeWidth={2.5} />
                          Add set
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
        </div>

        {/* Exercise swap modal */}
        {swapTarget && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
            <div className="w-full max-w-md bg-white">
              <div className="flex items-center justify-between border-b border-black/10 px-4 py-4">
                <p className="font-medium">{creatingExercise ? 'New exercise' : 'Swap exercise'}</p>
                <button type="button" onClick={closeSwap} className="text-black/40 hover:text-black">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {creatingExercise ? (
                <div className="px-4 py-4">
                  <div className="space-y-3">
                    <div>
                      <label className="text-[0.6rem] uppercase tracking-[0.14em] text-black/40">Exercise name</label>
                      <input
                        autoFocus
                        value={newExName}
                        onChange={(e) => { setNewExName(e.target.value); setCreateError(''); }}
                        placeholder="e.g. Copenhagen Plank"
                        className="mt-1 w-full border border-black/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-black/35"
                      />
                    </div>
                    <div>
                      <label className="text-[0.6rem] uppercase tracking-[0.14em] text-black/40">YouTube link (optional)</label>
                      <input
                        value={newExVideo}
                        onChange={(e) => { setNewExVideo(e.target.value); setCreateError(''); }}
                        placeholder="https://youtube.com/watch?v=..."
                        className="mt-1 w-full border border-black/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-black/35"
                        inputMode="url"
                      />
                    </div>
                    {getYouTubeId(newExVideo) && (
                      <img
                        src={`https://img.youtube.com/vi/${getYouTubeId(newExVideo)}/hqdefault.jpg`}
                        alt="Video preview"
                        className="aspect-video w-full border border-black/10 object-cover"
                      />
                    )}
                    {createError && <p className="text-xs text-red-600">{createError}</p>}
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { setCreatingExercise(false); setCreateError(''); }}
                      className="flex-1 border border-black/15 px-4 py-3 text-xs font-medium uppercase tracking-[0.12em] text-black/50 transition-colors hover:border-black/30 hover:text-black"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={() => void createAndSwapExercise()}
                      disabled={createBusy || !newExName.trim()}
                      className="flex-[2] border border-black bg-black px-4 py-3 text-xs font-medium uppercase tracking-[0.12em] text-white transition-colors hover:bg-black/85 disabled:opacity-40"
                    >
                      {createBusy ? 'Creating...' : 'Create & swap in'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
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
                      <p className="px-4 py-6 text-center text-sm text-black/40">No exercises found</p>
                    )}
                    {filteredExercises.map((ex) => (
                      <button
                        key={ex.id}
                        type="button"
                        onClick={() => swapExercise(swapTarget, ex)}
                        className="w-full px-4 py-3 text-left transition-colors hover:bg-black/4"
                      >
                        <p className="text-sm font-medium">{ex.name}</p>
                        {ex.muscles.length > 0 && (
                          <p className="mt-0.5 text-xs text-black/40">{ex.muscles.slice(0, 3).join(', ')}</p>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="border-t border-black/10 p-3">
                    <button
                      type="button"
                      onClick={() => { setCreatingExercise(true); setNewExName(swapSearch.trim()); setNewExVideo(''); setCreateError(''); }}
                      className="flex w-full items-center justify-center gap-2 border border-dashed border-black/20 px-4 py-3 text-xs font-medium uppercase tracking-[0.12em] text-black/50 transition-colors hover:border-black/40 hover:text-black"
                    >
                      <Plus className="h-4 w-4" />
                      Create new exercise
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ─── Render: 3-card pick view ─────────────────────────────────────────────

  const renderPickView = () => {
    const activePhase = assignment?.programme.phases[activePhaseIndex] ?? null;
    const activeProgress = phaseProgress[activePhaseIndex] ?? null;

    return (
      <div className="space-y-4">

        {/* Card 1: Next Session — read only from calendar */}
        <div className="border border-black/10 bg-white px-5 py-5">
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Next Session</p>
          {nextAppointment ? (
            <div className="mt-2">
              {isToday(nextAppointment.start_at) ? (
                <>
                  <p className="text-lg font-light">{nextAppointment.pt_clients?.name ?? '—'}</p>
                  <p className="mt-0.5 text-sm text-black/45">
                    Today · {formatBookingTime(new Date(nextAppointment.start_at))}
                  </p>
                  {nextAppointment.location && (
                    <p className="mt-0.5 text-xs text-black/35">{nextAppointment.location}</p>
                  )}
                  {hasMoreToday && (
                    <p className="mt-1 text-xs text-black/35">+{appointments.filter((a) => isToday(a.start_at)).length - 1} more today</p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-sm text-black/45">No more sessions today</p>
                  <p className="mt-1 text-sm font-light">
                    {isTomorrow(nextAppointment.start_at) ? 'Tomorrow' : formatBookingDate(new Date(nextAppointment.start_at))}
                    {' '}· {nextAppointment.pt_clients?.name ?? '—'}
                  </p>
                  <p className="mt-0.5 text-xs text-black/35">
                    {formatBookingTime(new Date(nextAppointment.start_at))}
                    {nextAppointment.location ? ` · ${nextAppointment.location}` : ''}
                  </p>
                </>
              )}
            </div>
          ) : (
            <p className="mt-2 text-sm text-black/40">No upcoming sessions booked</p>
          )}
        </div>

        {/* Card 2: Client — tap to select */}
        <div className="border border-black/10 bg-white">
          <button
            type="button"
            onClick={() => setShowClientSelector((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-5 text-left"
          >
            <div>
              <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Client</p>
              {selectedClient ? (
                <div className="mt-2 flex items-end justify-between gap-6">
                  <p className="text-lg font-light">{selectedClient.name}</p>
                  <div className="text-right">
                    <p className="text-2xl font-light leading-none">{selectedClient.sessions_remaining}</p>
                    <p className="text-[0.55rem] uppercase tracking-[0.12em] text-black/35">Sessions left</p>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-sm text-black/40">Tap to select client</p>
              )}
            </div>
            <ChevronDown className={`ml-4 h-4 w-4 shrink-0 text-black/35 transition-transform ${showClientSelector ? 'rotate-180' : ''}`} />
          </button>

          {showClientSelector && (
            <div className="border-t border-black/8">
              <div className="max-h-56 overflow-y-auto divide-y divide-black/8">
                {clients.map((c) => {
                  const isNextAppt = nextAppointment?.client_id === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setSelectedClient(c); setShowClientSelector(false); }}
                      className={`flex w-full items-center justify-between px-5 py-3 text-left text-sm transition-colors hover:bg-black/4 ${
                        selectedClient?.id === c.id ? 'bg-black/5' : ''
                      }`}
                    >
                      <span className={selectedClient?.id === c.id ? 'font-medium' : ''}>{c.name}</span>
                      {isNextAppt && (
                        <span className="text-[0.55rem] uppercase tracking-[0.12em] border border-black/15 px-1.5 py-0.5 text-black/40">
                          Next
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Card 3: Workout Programme — current phase only */}
        {selectedClient && (
          <div className="border border-black/10 bg-white">
            <div className="border-b border-black/8 px-5 py-4">
              <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Workout Programme</p>
            </div>

            {loadingClient ? (
              <div className="flex items-center justify-center px-5 py-10">
                <RefreshCw className="h-5 w-5 animate-spin text-black/30" />
              </div>
            ) : !assignment || !activePhase ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-black/40">No active programme for {selectedClient.name}</p>
              </div>
            ) : (
              <div>
                <div className="px-5 py-3 border-b border-black/8">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium">{activePhase.title}</p>
                    <p className="text-xs text-black/35">{activePhase.focus}</p>
                  </div>
                  {activeProgress && !activeProgress.allBlocksDone && (
                    <p className="mt-0.5 text-xs text-black/40">
                      Block {activeProgress.blockIndex + 1} · Week {activeProgress.weekWithinBlock}
                      {activeProgress.block?.sets ? ` · ${activeProgress.block.sets} sets` : ''}
                      {activeProgress.block?.weight_pct ? ` · ${activeProgress.block.weight_pct}` : ''}
                    </p>
                  )}
                  {activeProgress?.allBlocksDone && (
                    <span className="mt-1 inline-block text-[0.55rem] uppercase tracking-[0.1em] border border-green-300 bg-green-50 px-1.5 py-0.5 text-green-700">
                      Phase complete
                    </span>
                  )}
                </div>
                <div className="divide-y divide-black/8">
                  {activePhase.days.map((day, dayIndex) => {
                    const done = workoutIsDone(workoutLogs, activePhaseIndex, dayIndex, activeProgress);
                    const completedAt = done ? getWorkoutCompletedAt(workoutLogs, activePhaseIndex, dayIndex, activeProgress) : null;
                    return (
                      <button
                        key={day.id}
                        type="button"
                        onClick={() => setSelectedWorkout({ phaseIndex: activePhaseIndex, dayIndex })}
                        className="flex w-full items-center justify-between gap-3 bg-white px-5 py-4 text-left transition-colors hover:bg-black/4"
                      >
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm font-medium ${done ? 'text-black/40' : ''}`}>{day.title}</p>
                          <p className="mt-0.5 text-xs text-black/40">{day.focus}</p>
                          <p className="mt-1 text-[0.6rem] text-black/30">
                            {day.exercises.length} exercise{day.exercises.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          {done ? (
                            <>
                              <Check className="h-4 w-4 text-black/60" />
                              {completedAt && (
                                <p className="text-[0.65rem] text-black/50 leading-none">
                                  {new Date(completedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                                </p>
                              )}
                            </>
                          ) : (
                            <ChevronRight className="h-4 w-4 text-black/25" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* No Show — shown for every selected client */}
        {selectedClient && (
          <div className="border border-black/10 bg-white px-5 py-5">
            <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-3">Session attendance</p>
            {noShowStatus && (
              <p className="mb-3 text-sm text-red-600">{noShowStatus}</p>
            )}
            {selectedClientNextAppt ? (
              <>
                <button
                  type="button"
                  onClick={() => void handleNoShow()}
                  disabled={noShowBusy}
                  className="flex w-full items-center justify-center gap-2 border border-red-300 px-4 py-3 text-sm font-medium text-red-600 transition-colors hover:border-red-400 hover:bg-red-50 disabled:opacity-50"
                >
                  <AlertCircle className="h-4 w-4" />
                  {noShowBusy ? 'Marking...' : 'No Show — deduct 1 session'}
                </button>
                <p className="mt-2 text-center text-xs text-black/35">
                  Client did not attend · 1 session will be deducted
                </p>
              </>
            ) : (
              <p className="text-sm text-black/35">No upcoming appointment for {selectedClient.name}.</p>
            )}
          </div>
        )}
      </div>
    );
  };

  // ─── Main render ──────────────────────────────────────────────────────────

  return (
    <div ref={topRef} className="px-5 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-1">PT</p>
      <h1 className="font-display text-3xl font-light tracking-[-0.02em] mb-8">PT Sessions</h1>

      <div className="mx-auto max-w-3xl">
        {selectedWorkout ? renderWorkoutLogger() : renderPickView()}
      </div>
    </div>
  );
}
