'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Dumbbell, Home, Minus, Play, Plus, Wrench, X } from 'lucide-react';
import { computeAdherenceSnapshot, getGoalProgressLabel, latestMetricPair, monthEndInputValue, monthStartInputValue } from '@/utils/pt/coaching';
import { createClient } from '@/utils/supabase/client';
import { safeProgramme, getExerciseBlockValues, requiredWorkoutsForBlock } from '@/utils/pt/programme';
import { isPedroAdminEmail } from '@/utils/pt/access';
import {
  ACTIVE_BOOKING_STATUSES,
  PT_BOOKING_HORIZON_DAYS,
  PT_BOOKING_MIN_NOTICE_HOURS,
  activeBookingHoldCount,
  addDays,
  availableSessionCredits,
  formatBookingDate,
  formatBookingTime,
  overlaps,
  type PTBookableSlot,
  type PTBookingAppointment,
  type PTBookingAvailability,
  type PTBookingBlock,
  type PTBookingCancellationRequest,
} from '@/utils/pt/bookings';
import type {
  PTClient,
  PTClientGoal,
  PTClientMetric,
  PTCoachingReview,
  PTCoachingTask,
  PTProgramAssignment,
  PTProgrammeDay,
  PTProgrammeExercise,
  PTProgrammePhase,
  PTProgrammeWeekBlock,
  PTSetLog,
  PTWeeklyPlan,
  PTWeeklyPlanItem,
  PTWeeklyPlanItemType,
  PTWeeklyCheckin,
} from '@/utils/pt/types';
import MessageBubble from './MessageBubble';

const PLAN_ITEM_LABELS: Record<PTWeeklyPlanItemType, string> = {
  pt_session: 'PT session',
  solo_strength: 'Solo strength',
  run: 'Run',
  golf_mobility: 'Golf mobility',
  recovery: 'Recovery',
  nutrition: 'Nutrition',
  check_in: 'Check-in',
};

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

interface VideoState {
  id: string;
  title: string;
}

interface WeeklyResetDraft {
  availability: string;
  golf_days: string;
  run_days: string;
  energy: string;
  soreness: string;
  sleep: string;
  stress: string;
  travel: string;
  injuries: string;
  nutrition_focus: string;
  nutrition_obstacles: string;
  client_focus: string;
}

interface MetricDraft {
  measured_at: string;
  weight_kg: string;
  waist_cm: string;
  body_fat_pct: string;
  muscle_mass_kg: string;
  source: 'manual' | 'scale';
  notes: string;
}

type ClientScreen = 'overview' | 'workout' | 'tools';

const emptyWeeklyReset: WeeklyResetDraft = {
  availability: '',
  golf_days: '',
  run_days: '',
  energy: '',
  soreness: '',
  sleep: '',
  stress: '',
  travel: '',
  injuries: '',
  nutrition_focus: '',
  nutrition_obstacles: '',
  client_focus: '',
};

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

function todayInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function weekStartInputValue(date = new Date()) {
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  const year = next.getFullYear();
  const month = String(next.getMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(next.getDate()).padStart(2, '0');
  return `${year}-${month}-${dayOfMonth}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
  });
}

function formatWeekRange(weekStart: string) {
  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${start.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} - ${end.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`;
}

function formatMetric(value: number | null, suffix: string) {
  return value === null || value === undefined ? '-' : `${Number(value).toLocaleString('en-AU')} ${suffix}`;
}

function timeToMinutes(value: string) {
  const [hour, minute] = value.slice(0, 5).split(':').map(Number);
  return hour * 60 + minute;
}

function slotSessionMinutes(window: PTBookingAvailability) {
  return Number(window.session_duration_minutes ?? 45);
}

function slotStepMinutes(window: PTBookingAvailability) {
  return slotSessionMinutes(window) + Number(window.buffer_minutes ?? Math.max(0, window.slot_duration_minutes - slotSessionMinutes(window)));
}

function calendarDateKey(date: Date | string) {
  const value = typeof date === 'string' ? new Date(date) : date;
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function generateBookableSlots(
  availability: PTBookingAvailability[],
  blocks: PTBookingBlock[],
  ownBookings: PTBookingAppointment[],
  canBook: boolean,
): PTBookableSlot[] {
  const now = new Date();
  const minDate = new Date(now.getTime() + PT_BOOKING_MIN_NOTICE_HOURS * 60 * 60 * 1000);
  const maxDate = addDays(now, PT_BOOKING_HORIZON_DAYS);
  const slots: PTBookableSlot[] = [];

  for (let offset = 0; offset <= PT_BOOKING_HORIZON_DAYS; offset++) {
    const day = addDays(now, offset);
    const windows = availability.filter((window) => window.day_of_week === day.getDay() && window.is_active);
    windows.forEach((window) => {
      const duration = slotSessionMinutes(window);
      const step = slotStepMinutes(window);
      for (
        let minute = timeToMinutes(window.start_time);
        minute + duration <= timeToMinutes(window.end_time);
        minute += step
      ) {
        const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minute / 60), minute % 60);
        const end = new Date(start.getTime() + duration * 60000);
        if (start < minDate || start > maxDate) continue;
        const taken = blocks.some((block) => overlaps(start, end, block.start_at, block.end_at));
        const own = ownBookings.some((booking) =>
          ACTIVE_BOOKING_STATUSES.includes(booking.status) && overlaps(start, end, booking.start_at, booking.end_at),
        );
        slots.push({
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          label: `${formatBookingDate(start)} · ${formatBookingTime(start)}`,
          available: canBook && !taken && !own,
          reason: !canBook ? 'No sessions available' : own ? 'You booked this' : taken ? 'Taken' : undefined,
          availability_id: window.id,
          location: window.location,
        });
      }
    });
  }

  return slots;
}

function getExerciseHistoryKey(exercise: PTProgrammeExercise) {
  return exercise.exercise_id ?? exercise.name.toLowerCase();
}

function getYouTubeId(url: string | null) {
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

function getYouTubeEmbedUrl(videoId: string, autoplay = false) {
  const params = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
    enablejsapi: '1',
    playerapiid: videoId,
  });
  if (typeof window !== 'undefined') params.set('origin', window.location.origin);
  if (autoplay) params.set('autoplay', '1');
  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
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
  const isPedro = isPedroAdminEmail(userEmail);
  const [activeScreen, setActiveScreen] = useState<ClientScreen>('overview');
  const [client, setClient] = useState<PTClient | null>(null);
  const [assignments, setAssignments] = useState<PTProgramAssignment[]>([]);
  const [setLogs, setSetLogs] = useState<PTSetLog[]>([]);
  const [workoutLogs, setWorkoutLogs] = useState<WorkoutLog[]>([]);
  const [weeklyCheckins, setWeeklyCheckins] = useState<PTWeeklyCheckin[]>([]);
  const [weeklyPlans, setWeeklyPlans] = useState<PTWeeklyPlan[]>([]);
  const [weeklyPlanItems, setWeeklyPlanItems] = useState<PTWeeklyPlanItem[]>([]);
  const [metrics, setMetrics] = useState<PTClientMetric[]>([]);
  const [goals, setGoals] = useState<PTClientGoal[]>([]);
  const [reviews, setReviews] = useState<PTCoachingReview[]>([]);
  const [bookingAvailability, setBookingAvailability] = useState<PTBookingAvailability[]>([]);
  const [bookings, setBookings] = useState<PTBookingAppointment[]>([]);
  const [bookingBlocks, setBookingBlocks] = useState<PTBookingBlock[]>([]);
  const [cancellationRequests, setCancellationRequests] = useState<PTBookingCancellationRequest[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<PTBookableSlot | null>(null);
  const [bookingMonth, setBookingMonth] = useState(() => {
    const date = new Date();
    date.setDate(1);
    return date;
  });
  const [recurringWeeks, setRecurringWeeks] = useState('1');
  const [bookingReason, setBookingReason] = useState('');
  const [bookingBusy, setBookingBusy] = useState(false);
  const [resetDraft, setResetDraft] = useState<WeeklyResetDraft>(emptyWeeklyReset);
  const [metricDraft, setMetricDraft] = useState<MetricDraft>({
    measured_at: todayInputValue(),
    weight_kg: '',
    waist_cm: '',
    body_fat_pct: '',
    muscle_mass_kg: '',
    source: 'scale',
    notes: '',
  });
  const [setDrafts, setSetDrafts] = useState<Record<string, SetDraft>>({});
  const [setCounts, setSetCounts] = useState<Record<string, number>>({});
  const [sectionNotes, setSectionNotes] = useState<Record<string, string>>({});
  const [submittedSectionNotes, setSubmittedSectionNotes] = useState<Record<string, boolean>>({});
  const [submittingSectionNote, setSubmittingSectionNote] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [openCues, setOpenCues] = useState<Record<string, boolean>>({});
  const [selectedWorkout, setSelectedWorkout] = useState<SelectedWorkout | null>(null);
  const [activeVideo, setActiveVideo] = useState<VideoState | null>(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingWorkout, setSavingWorkout] = useState(false);
  const [submittingReset, setSubmittingReset] = useState(false);
  const [submittingMetric, setSubmittingMetric] = useState(false);
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

    const bookingRangeStart = new Date().toISOString();
    const bookingRangeEnd = addDays(new Date(), PT_BOOKING_HORIZON_DAYS + 7).toISOString();
    const [
      assignmentRes,
      logsRes,
      workoutLogsRes,
      checkinsRes,
      plansRes,
      planItemsRes,
      metricsRes,
      goalsRes,
      reviewsRes,
      availabilityRes,
      bookingRes,
      blockRes,
      cancellationRes,
    ] = await Promise.all([
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
      supabase
        .from('pt_weekly_checkins')
        .select('*')
        .eq('client_id', currentClient.id)
        .order('week_start', { ascending: false })
        .limit(6),
      supabase
        .from('pt_weekly_plans')
        .select('*')
        .eq('client_id', currentClient.id)
        .eq('status', 'published')
        .order('week_start', { ascending: false })
        .limit(4),
      supabase
        .from('pt_weekly_plan_items')
        .select('*')
        .eq('client_id', currentClient.id)
        .order('scheduled_date', { ascending: true })
        .order('sort_order', { ascending: true }),
      supabase
        .from('pt_client_metrics')
        .select('*')
        .eq('client_id', currentClient.id)
        .order('measured_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(12),
      supabase
        .from('pt_client_goals')
        .select('*')
        .eq('client_id', currentClient.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(8),
      supabase
        .from('pt_coaching_reviews')
        .select('*')
        .eq('client_id', currentClient.id)
        .eq('review_type', 'monthly')
        .eq('status', 'final')
        .order('period_start', { ascending: false })
        .limit(3),
      supabase
        .from('pt_booking_availability')
        .select('*')
        .eq('is_active', true)
        .order('day_of_week', { ascending: true })
        .order('start_time', { ascending: true }),
      supabase
        .from('pt_booking_appointments')
        .select('*')
        .eq('client_id', currentClient.id)
        .gte('start_at', bookingRangeStart)
        .lt('start_at', bookingRangeEnd)
        .order('start_at', { ascending: true }),
      supabase
        .from('pt_booking_blocks')
        .select('*')
        .eq('status', 'active')
        .gte('end_at', bookingRangeStart)
        .lt('start_at', bookingRangeEnd)
        .order('start_at', { ascending: true }),
      supabase
        .from('pt_booking_cancellation_requests')
        .select('*')
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
    setWeeklyCheckins((checkinsRes.data ?? []) as PTWeeklyCheckin[]);
    setWeeklyPlans((plansRes.data ?? []) as PTWeeklyPlan[]);
    setWeeklyPlanItems((planItemsRes.data ?? []) as PTWeeklyPlanItem[]);
    setMetrics((metricsRes.data ?? []) as PTClientMetric[]);
    setGoals((goalsRes.data ?? []) as PTClientGoal[]);
    setReviews((reviewsRes.data ?? []) as PTCoachingReview[]);
    setBookingAvailability((availabilityRes.data ?? []) as PTBookingAvailability[]);
    setBookings((bookingRes.data ?? []) as PTBookingAppointment[]);
    setBookingBlocks((blockRes.data ?? []) as PTBookingBlock[]);
    setCancellationRequests((cancellationRes.data ?? []) as PTBookingCancellationRequest[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    const id = window.setTimeout(() => { void loadPortal(); }, 0);
    return () => window.clearTimeout(id);
  }, [loadPortal]);

  useEffect(() => {
    if (!activeVideo) return;

    const handleMessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      try {
        const payload = JSON.parse(event.data) as { event?: string; info?: number };
        if (payload.event === 'onStateChange' && payload.info === 0) setActiveVideo(null);
      } catch {
        return;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [activeVideo]);

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
  const currentWeekStart = weekStartInputValue();
  const latestCheckin = weeklyCheckins[0] ?? null;
  const latestMetric = metrics[0] ?? null;
  const monthlyReview = reviews[0] ?? null;
  const weightPair = latestMetricPair(metrics, 'weight_kg');
  const waistPair = latestMetricPair(metrics, 'waist_cm');
  const monthlyAdherence = computeAdherenceSnapshot(
    weeklyPlanItems,
    weeklyPlans,
    monthStartInputValue(currentWeekStart),
    monthEndInputValue(currentWeekStart),
  );
  const currentWeeklyPlan = weeklyPlans.find((plan) => plan.week_start === currentWeekStart)
    ?? weeklyPlans.find((plan) => plan.week_start > currentWeekStart)
    ?? null;
  const currentWeeklyPlanItems = weeklyPlanItems
    .filter((item) => item.plan_id === currentWeeklyPlan?.id)
    .sort((a, b) => {
      const dateCompare = (a.scheduled_date ?? '').localeCompare(b.scheduled_date ?? '');
      if (dateCompare !== 0) return dateCompare;
      return a.sort_order - b.sort_order;
    });
  const dueTodayItems = currentWeeklyPlanItems.filter((item) => item.scheduled_date === todayInputValue() && item.status === 'planned');
  const nextPlanItem = currentWeeklyPlanItems.find((item) => item.status === 'planned') ?? null;
  const activeBookings = bookings.filter((booking) => ACTIVE_BOOKING_STATUSES.includes(booking.status));
  const nextBooking = activeBookings.find((booking) => new Date(booking.start_at).getTime() > Date.now()) ?? null;
  const heldCredits = activeBookingHoldCount(bookings);
  const availableCredits = availableSessionCredits(client, bookings);
  const bookableSlots = useMemo(
    () => generateBookableSlots(bookingAvailability, bookingBlocks, bookings, availableCredits > 0),
    [availableCredits, bookingAvailability, bookingBlocks, bookings],
  );
  const slotsByDate = useMemo(() => {
    const map = new Map<string, PTBookableSlot[]>();
    bookableSlots.forEach((slot) => {
      const key = calendarDateKey(slot.start_at);
      map.set(key, [...(map.get(key) ?? []), slot]);
    });
    map.forEach((items) => items.sort((a, b) => a.start_at.localeCompare(b.start_at)));
    return map;
  }, [bookableSlots]);
  const calendarDays = useMemo(() => {
    const first = new Date(bookingMonth.getFullYear(), bookingMonth.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [bookingMonth]);
  const pendingCancellationIds = new Set(
    cancellationRequests
      .filter((request) => request.status === 'pending')
      .map((request) => request.appointment_id),
  );

  const renderDelta = (current: number | null | undefined, previous: number | null | undefined, unit: string) => {
    if (current === null || current === undefined) return 'No reading yet';
    if (previous === null || previous === undefined) return `Latest ${current}${unit}`;
    const delta = Number((Number(current) - Number(previous)).toFixed(1));
    if (delta === 0) return `Holding at ${current}${unit}`;
    return `${current}${unit} (${delta > 0 ? '+' : ''}${delta}${unit})`;
  };

  const lastSetsByExercise = useMemo(() => {
    const map = new Map<string, PTSetLog[]>();
    const seen = new Set<string>();
    setLogs.forEach((log) => {
      const key = log.exercise_id ?? log.exercise_name.toLowerCase();
      const setKey = `${key}-${log.set_number}`;
      if (seen.has(setKey)) return;
      seen.add(setKey);
      const logs = map.get(key) ?? [];
      logs.push(log);
      map.set(key, logs);
    });
    map.forEach((logs) => logs.sort((a, b) => a.set_number - b.set_number));
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

  const addExerciseSet = (exercise: PTProgrammeExercise, currentCount: number) => {
    if (!selectedWorkout) return;
    const nextIndex = currentCount;
    const key = draftKey(selectedWorkout.phaseIndex, selectedWorkout.dayIndex, exercise.id, nextIndex);
    const history = lastSetsByExercise.get(getExerciseHistoryKey(exercise)) ?? [];
    const previous = history[nextIndex] ?? history[history.length - 1];

    setSetDrafts((current) => ({
      ...current,
      [key]: current[key] ?? {
        reps: '',
        weight: previous?.weight !== null && previous?.weight !== undefined ? String(previous.weight) : '',
      },
    }));
    setExerciseCount(exercise.id, currentCount + 1);
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
    setSetDrafts((current) => {
      const next = { ...current };
      getWorkoutSections(day, phase, blockIndex).forEach((section) => {
        section.exercises.forEach(({ exercise, values }) => {
          const history = lastSetsByExercise.get(getExerciseHistoryKey(exercise)) ?? [];
          const count = parseSets(values.sets);
          Array.from({ length: count }).forEach((_, setIndex) => {
            const key = draftKey(phaseIndex, dayIndex, exercise.id, setIndex);
            if (next[key]) return;
            const previous = history[setIndex] ?? history[history.length - 1];
            next[key] = {
              reps: '',
              weight: previous?.weight !== null && previous?.weight !== undefined ? String(previous.weight) : '',
            };
          });
        });
      });
      return next;
    });
  };

  const closeWorkout = () => {
    setSelectedWorkout(null);
    setStatus('');
  };

  const submitSectionNote = async (section: WorkoutSectionView, noteKey: string) => {
    if (!client || !assignment || !selectedWorkout || !selectedPhase || !selectedDay) return;
    const note = sectionNotes[noteKey]?.trim();
    if (!note) return;

    setSubmittingSectionNote(noteKey);
    setStatus('');
    const { error } = await supabase.from('pt_client_notes').insert({
      client_id: client.id,
      content: note,
      context: {
        source: 'workout_section',
        assignment_id: assignment.id,
        phase_index: selectedWorkout.phaseIndex,
        phase_title: selectedPhase.title,
        day_index: selectedWorkout.dayIndex,
        workout_title: selectedDay.title,
        section_id: section.id,
        section_title: section.title,
        week_number: selectedProgress?.weekWithinBlock ?? 1,
        block_index: selectedProgress?.blockIndex ?? 0,
      },
    });

    if (error) {
      setStatus(error.message);
    } else {
      setSectionNotes((current) => ({ ...current, [noteKey]: '' }));
      setSubmittedSectionNotes((current) => ({ ...current, [noteKey]: true }));
      setStatus('Note sent to Pedro.');
    }
    setSubmittingSectionNote(null);
  };

  const patchResetDraft = (patch: Partial<WeeklyResetDraft>) => {
    setResetDraft((current) => ({ ...current, ...patch }));
  };

  const patchMetricDraft = (patch: Partial<MetricDraft>) => {
    setMetricDraft((current) => ({ ...current, ...patch }));
  };

  const submitWeeklyReset = async () => {
    if (!client || submittingReset) return;

    setSubmittingReset(true);
    setStatus('Submitting weekly reset...');

    const { data, error } = await supabase
      .from('pt_weekly_checkins')
      .insert({
        client_id: client.id,
        week_start: currentWeekStart,
        availability: resetDraft.availability.trim() || null,
        golf_days: resetDraft.golf_days.trim() || null,
        run_days: resetDraft.run_days.trim() || null,
        energy: toNullableNumber(resetDraft.energy),
        soreness: toNullableNumber(resetDraft.soreness),
        sleep: toNullableNumber(resetDraft.sleep),
        stress: toNullableNumber(resetDraft.stress),
        travel: resetDraft.travel.trim() || null,
        injuries: resetDraft.injuries.trim() || null,
        nutrition_focus: resetDraft.nutrition_focus.trim() || null,
        nutrition_obstacles: resetDraft.nutrition_obstacles.trim() || null,
        client_focus: resetDraft.client_focus.trim() || null,
      })
      .select('*')
      .single();

    if (error || !data) {
      setStatus(error?.message ?? 'Could not submit weekly reset.');
      setSubmittingReset(false);
      return;
    }

    const checkin = data as PTWeeklyCheckin;
    const task: Omit<PTCoachingTask, 'id' | 'created_at' | 'updated_at' | 'completed_at'> = {
      client_id: client.id,
      source_type: 'weekly_checkin',
      source_id: checkin.id,
      title: 'Review weekly reset',
      details: checkin.client_focus || checkin.availability || 'Weekly reset submitted.',
      priority: checkin.injuries || checkin.travel ? 'high' : 'normal',
      status: 'open',
      due_at: new Date().toISOString(),
    };
    const { error: taskError } = await supabase.from('pt_coaching_tasks').insert(task);

    setWeeklyCheckins((current) => [checkin, ...current.filter((item) => item.id !== checkin.id)]);
    setResetDraft(emptyWeeklyReset);
    setStatus(taskError ? `Weekly reset saved, but Pedro task failed: ${taskError.message}` : 'Weekly reset sent to Pedro.');
    setSubmittingReset(false);
  };

  const submitMetric = async () => {
    if (!client || submittingMetric) return;

    const hasValue = [
      metricDraft.weight_kg,
      metricDraft.waist_cm,
      metricDraft.body_fat_pct,
      metricDraft.muscle_mass_kg,
      metricDraft.notes,
    ].some((value) => value.trim());
    if (!hasValue) {
      setStatus('Add at least one metric or note.');
      return;
    }

    setSubmittingMetric(true);
    setStatus('Saving metrics...');

    const { data, error } = await supabase
      .from('pt_client_metrics')
      .insert({
        client_id: client.id,
        measured_at: metricDraft.measured_at,
        weight_kg: toNullableNumber(metricDraft.weight_kg),
        waist_cm: toNullableNumber(metricDraft.waist_cm),
        body_fat_pct: toNullableNumber(metricDraft.body_fat_pct),
        muscle_mass_kg: toNullableNumber(metricDraft.muscle_mass_kg),
        source: metricDraft.source,
        notes: metricDraft.notes.trim() || null,
      })
      .select('*')
      .single();

    if (error || !data) {
      setStatus(error?.message ?? 'Could not save metrics.');
      setSubmittingMetric(false);
      return;
    }

    const metric = data as PTClientMetric;
    const details = [
      metric.weight_kg !== null ? `Weight ${metric.weight_kg}kg` : null,
      metric.waist_cm !== null ? `Waist ${metric.waist_cm}cm` : null,
      metric.body_fat_pct !== null ? `Body fat ${metric.body_fat_pct}%` : null,
      metric.muscle_mass_kg !== null ? `Muscle ${metric.muscle_mass_kg}kg` : null,
      metric.notes,
    ].filter(Boolean).join(' / ');
    const { error: taskError } = await supabase.from('pt_coaching_tasks').insert({
      client_id: client.id,
      source_type: 'metric_update',
      source_id: metric.id,
      title: 'Review body metrics',
      details: details || 'Metric update submitted.',
      priority: 'normal',
      status: 'open',
      due_at: new Date().toISOString(),
    });

    setMetrics((current) => [metric, ...current.filter((item) => item.id !== metric.id)]);
    setMetricDraft({
      measured_at: todayInputValue(),
      weight_kg: '',
      waist_cm: '',
      body_fat_pct: '',
      muscle_mass_kg: '',
      source: 'scale',
      notes: '',
    });
    setStatus(taskError ? `Metrics saved, but Pedro task failed: ${taskError.message}` : 'Metrics sent to Pedro.');
    setSubmittingMetric(false);
  };

  const markPlanItemStatus = async (item: PTWeeklyPlanItem, nextStatus: 'done' | 'skipped') => {
    const completedAt = nextStatus === 'done' ? new Date().toISOString() : null;
    const { error } = await supabase
      .from('pt_weekly_plan_items')
      .update({
        status: nextStatus,
        completed_at: completedAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id);

    if (error) {
      setStatus(error.message);
      return;
    }

    setWeeklyPlanItems((current) => current.map((planItem) => (
      planItem.id === item.id
        ? { ...planItem, status: nextStatus, completed_at: completedAt }
        : planItem
    )));
  };

  const bookSelectedSlot = async () => {
    if (!selectedSlot || bookingBusy) return;
    setBookingBusy(true);
    setStatus('Booking session...');
    const { data, error } = await supabase.functions.invoke<{ error?: string }>('manage-pt-booking', {
      body: {
        action: 'create',
        start_at: selectedSlot.start_at,
        recurring_weeks: Number(recurringWeeks),
      },
    });

    if (error || data?.error) {
      setStatus(error?.message ?? data?.error ?? 'Could not book session.');
    } else {
      setStatus('Session booked. Check your email for the confirmation.');
      setSelectedSlot(null);
      await loadPortal();
    }
    setBookingBusy(false);
  };

  const cancelBooking = async (booking: PTBookingAppointment) => {
    if (bookingBusy) return;
    const startsWithin24Hours = new Date(booking.start_at).getTime() - Date.now() < 24 * 60 * 60 * 1000;
    if (startsWithin24Hours && !bookingReason.trim()) {
      setStatus('Add a reason so Pedro can review the late cancellation.');
      return;
    }

    setBookingBusy(true);
    setStatus(startsWithin24Hours ? 'Sending cancellation request...' : 'Cancelling booking...');
    const { data, error } = await supabase.functions.invoke<{ error?: string; status?: string }>('manage-pt-booking', {
      body: {
        action: 'cancel',
        appointment_id: booking.id,
        reason: startsWithin24Hours ? bookingReason.trim() : 'Cancelled by client.',
      },
    });

    if (error || data?.error) {
      setStatus(error?.message ?? data?.error ?? 'Could not cancel booking.');
    } else {
      setBookingReason('');
      setStatus(data?.status === 'cancellation_requested' ? 'Pedro has received your cancellation request.' : 'Booking cancelled.');
      await loadPortal();
    }
    setBookingBusy(false);
  };

  const openLinkedPlanWorkout = (item: PTWeeklyPlanItem) => {
    if (
      !assignment ||
      item.linked_assignment_id !== assignment.id ||
      item.linked_phase_index === null ||
      item.linked_day_index === null
    ) return;

    openWorkout(item.linked_phase_index, item.linked_day_index);
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

    const linkedPlanItem = currentWeeklyPlanItems.find((item) =>
      item.linked_assignment_id === assignment.id &&
      item.linked_phase_index === selectedWorkout.phaseIndex &&
      item.linked_day_index === selectedWorkout.dayIndex &&
      item.status === 'planned'
    );
    if (linkedPlanItem) {
      await supabase
        .from('pt_weekly_plan_items')
        .update({ status: 'done', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', linkedPlanItem.id);
    }

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

      if (
        newProgress &&
        (newProgress.blockIndex !== progress.blockIndex || newProgress.weekWithinBlock !== progress.weekWithinBlock)
      ) {
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
    <header className="border-b border-black/10 bg-white px-4 py-4 md:px-10 md:py-5">
      <p className="text-[0.65rem] uppercase tracking-[0.2em] text-black/35">Pedro Avila Coaching</p>
      <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <h1 className="font-display text-2xl font-light tracking-[-0.02em] md:text-3xl">Training</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <p className="max-w-[13rem] truncate text-xs text-black/40 md:max-w-none">{userEmail}</p>
          {isPedro ? (
            <a href="/dashboard" className="text-xs text-black/50 underline hover:text-black">Back to dashboard</a>
          ) : (
            <button
              type="button"
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.replace('/client-login');
              }}
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
      <div className="mt-5 border border-black/8 bg-[#fbfbf8] px-3 py-3 md:px-4">
        <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[0.6rem] uppercase tracking-[0.15em] text-black/35">Progress</p>
          {progress.allBlocksDone ? (
            <span className="text-[0.6rem] uppercase tracking-[0.1em] border border-green-300 bg-green-50 px-2 py-0.5 text-green-700">
              Phase complete
            </span>
          ) : (
            <span className="text-[0.65rem] text-black/50">
              Block {progress.blockIndex + 1} of {phase.week_blocks.length} · Week {progress.weekWithinBlock} of {progress.block?.weeks ?? '?'} · {progress.block?.sets ? `${progress.block.sets} sets` : progress.block?.weight_pct ?? 'Progression'}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {Array.from({ length: progress.block?.weeks ?? 0 }).map((_, weekIndex) => {
            const weekNumber = weekIndex + 1;
            const logsInWeek = workoutLogs.filter(
              (log) =>
                log.phase_index === activePhaseIndex &&
                log.block_index === progress.blockIndex &&
                log.week_number === weekNumber,
            );
            const doneDays = new Set(logsInWeek.map((log) => log.day_index)).size;
            const isDone = progress.allBlocksDone || doneDays >= phase.days.length;
            const isCurrent = !progress.allBlocksDone && weekNumber === progress.weekWithinBlock;
            return (
              <div
                key={`week-${weekNumber}`}
                className={`min-w-0 flex-1 py-1.5 text-center text-[0.52rem] uppercase tracking-[0.08em] sm:text-[0.55rem] ${
                  isDone
                    ? 'bg-black text-white'
                    : isCurrent
                    ? 'border border-black/30 bg-black/10 text-black/70'
                    : 'border border-black/8 bg-black/4 text-black/25'
                }`}
              >
                Week {weekNumber}
                <span className="block text-[0.48rem] normal-case opacity-70">{doneDays}/{phase.days.length}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderCoachingHome = () => (
    <div className="mx-auto max-w-5xl space-y-4 md:space-y-6">
      <section className="border border-black/10 bg-white p-4 md:p-5">
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">This Week</p>
            <h2 className="mt-2 font-display text-2xl font-light">
              {formatWeekRange(currentWeeklyPlan?.week_start ?? currentWeekStart)}
            </h2>
            {currentWeeklyPlan ? (
              <>
                {currentWeeklyPlan.client_note && (
                  <p className="mt-2 text-sm leading-relaxed text-black/60">{currentWeeklyPlan.client_note}</p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="border border-black/10 bg-[#fbfbf8] px-3 py-1.5 text-xs text-black/55">
                    Slot: {currentWeeklyPlan.regular_slot || 'Not set'}
                  </span>
                  <span className={`border px-3 py-1.5 text-xs ${
                    currentWeeklyPlan.regular_slot_status === 'confirmed'
                      ? 'border-green-200 bg-green-50 text-green-700'
                      : 'border-amber-200 bg-amber-50 text-amber-700'
                  }`}>
                    {currentWeeklyPlan.regular_slot_status.replace(/_/g, ' ')}
                  </span>
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm leading-relaxed text-black/55">
                Send Pedro the shape of your week before he adjusts training, running, mobility, and nutrition.
              </p>
            )}
          </div>
          <div className="border border-black/8 bg-[#fbfbf8] p-3">
            <p className="text-[0.6rem] uppercase tracking-[0.16em] text-black/35">
              {dueTodayItems.length > 0 ? 'Due today' : 'Next'}
            </p>
            {dueTodayItems.length > 0 ? (
              <div className="mt-2 space-y-2">
                {dueTodayItems.slice(0, 2).map((item) => (
                  <p key={item.id} className="text-sm font-medium">{item.title}</p>
                ))}
              </div>
            ) : nextPlanItem ? (
              <>
                <p className="mt-2 text-sm font-medium">{nextPlanItem.title}</p>
                <p className="mt-1 text-xs text-black/45">
                  {nextPlanItem.scheduled_date ? formatDate(nextPlanItem.scheduled_date) : PLAN_ITEM_LABELS[nextPlanItem.item_type]}
                </p>
              </>
            ) : latestCheckin ? (
              <>
                <p className="mt-2 text-sm font-medium">Week of {formatDate(latestCheckin.week_start)}</p>
                <p className="mt-1 text-xs leading-relaxed text-black/50">
                  {latestCheckin.client_focus || latestCheckin.availability || 'Pedro has your reset.'}
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-black/45">No weekly reset sent yet.</p>
            )}
          </div>
        </div>
      </section>

      {currentWeeklyPlan && (
        <section className="border border-black/10 bg-white p-4 md:p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Plan</p>
            <p className="text-xs text-black/35">
              {currentWeeklyPlanItems.filter((item) => item.status === 'done').length}/{currentWeeklyPlanItems.length} done
            </p>
          </div>
          {currentWeeklyPlanItems.length === 0 ? (
            <p className="mt-3 text-sm text-black/45">Pedro has published the week, but no items are listed yet.</p>
          ) : (
            <div className="mt-4 grid gap-2">
              {currentWeeklyPlanItems.map((item) => {
                const isLinkedWorkout = Boolean(
                  assignment &&
                  item.linked_assignment_id === assignment.id &&
                  item.linked_phase_index !== null &&
                  item.linked_day_index !== null,
                );
                return (
                  <div key={item.id} className={`border px-3 py-3 ${
                    item.status === 'done'
                      ? 'border-green-200 bg-green-50/60'
                      : item.status === 'skipped'
                      ? 'border-black/8 bg-black/3 opacity-70'
                      : 'border-black/8 bg-[#fbfbf8]'
                  }`}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[0.6rem] uppercase tracking-[0.14em] text-black/35">
                            {PLAN_ITEM_LABELS[item.item_type]}
                          </span>
                          {item.scheduled_date && <span className="text-xs text-black/35">{formatDate(item.scheduled_date)}</span>}
                          {item.confirmation_status !== 'none' && (
                            <span className="border border-amber-200 bg-amber-50 px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.08em] text-amber-700">
                              {item.confirmation_status.replace(/_/g, ' ')}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm font-medium text-black">{item.title}</p>
                        {item.details && <p className="mt-1 text-xs leading-relaxed text-black/50">{item.details}</p>}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {isLinkedWorkout && item.status !== 'done' && (
                          <button
                            type="button"
                            onClick={() => openLinkedPlanWorkout(item)}
                            className="border border-black bg-black px-3 py-2 text-xs text-white transition-opacity hover:opacity-80"
                          >
                            Open workout
                          </button>
                        )}
                        {item.status === 'planned' && !isLinkedWorkout && (
                          <button
                            type="button"
                            onClick={() => void markPlanItemStatus(item, 'done')}
                            className="border border-black/15 bg-white px-3 py-2 text-xs text-black/55 transition-colors hover:border-black hover:text-black"
                          >
                            Mark done
                          </button>
                        )}
                        {item.status === 'planned' && (
                          <button
                            type="button"
                            onClick={() => void markPlanItemStatus(item, 'skipped')}
                            className="text-xs text-black/35 underline-offset-2 hover:text-black hover:underline"
                          >
                            Skip
                          </button>
                        )}
                        {item.status === 'done' && <span className="text-xs font-medium text-green-700">Done</span>}
                        {item.status === 'skipped' && <span className="text-xs text-black/35">Skipped</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="border border-black/10 bg-white p-4 md:p-5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Weekly Reset</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-xs text-black/45">Availability</span>
              <textarea value={resetDraft.availability} onChange={(event) => patchResetDraft({ availability: event.target.value })}
                rows={3} className="mt-1 w-full resize-none border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/35"
                placeholder="Days, times, work constraints." />
            </label>
            <label className="block">
              <span className="text-xs text-black/45">What do you want help with?</span>
              <textarea value={resetDraft.client_focus} onChange={(event) => patchResetDraft({ client_focus: event.target.value })}
                rows={3} className="mt-1 w-full resize-none border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/35"
                placeholder="The thing Pedro should solve this week." />
            </label>
            <label className="block">
              <span className="text-xs text-black/45">Golf days</span>
              <input value={resetDraft.golf_days} onChange={(event) => patchResetDraft({ golf_days: event.target.value })}
                className="mt-1 w-full border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/35" placeholder="e.g. Tue, Sat" />
            </label>
            <label className="block">
              <span className="text-xs text-black/45">Runs or desired runs</span>
              <input value={resetDraft.run_days} onChange={(event) => patchResetDraft({ run_days: event.target.value })}
                className="mt-1 w-full border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/35" placeholder="e.g. 2 easy runs" />
            </label>
            <label className="block">
              <span className="text-xs text-black/45">Travel or schedule changes</span>
              <input value={resetDraft.travel} onChange={(event) => patchResetDraft({ travel: event.target.value })}
                className="mt-1 w-full border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/35" placeholder="Travel, late nights, busy days." />
            </label>
            <label className="block">
              <span className="text-xs text-black/45">Injuries, pain, soreness</span>
              <input value={resetDraft.injuries} onChange={(event) => patchResetDraft({ injuries: event.target.value })}
                className="mt-1 w-full border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/35" placeholder="Anything Pedro needs to know." />
            </label>
            <label className="block">
              <span className="text-xs text-black/45">Nutrition focus</span>
              <input value={resetDraft.nutrition_focus} onChange={(event) => patchResetDraft({ nutrition_focus: event.target.value })}
                className="mt-1 w-full border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/35" placeholder="Protein, alcohol, meals, weekends." />
            </label>
            <label className="block">
              <span className="text-xs text-black/45">Nutrition obstacles</span>
              <input value={resetDraft.nutrition_obstacles} onChange={(event) => patchResetDraft({ nutrition_obstacles: event.target.value })}
                className="mt-1 w-full border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/35" placeholder="Work lunches, travel, social plans." />
            </label>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([
              ['Energy', 'energy'],
              ['Soreness', 'soreness'],
              ['Sleep', 'sleep'],
              ['Stress', 'stress'],
            ] as Array<[string, keyof WeeklyResetDraft]>).map(([label, key]) => (
              <label key={key} className="block">
                <span className="text-xs text-black/45">{label}</span>
                <select value={resetDraft[key]} onChange={(event) => patchResetDraft({ [key]: event.target.value })}
                  className="mt-1 w-full border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/35">
                  <option value="">-</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                </select>
              </label>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void submitWeeklyReset()}
            disabled={submittingReset}
            className="mt-5 w-full bg-black px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-black/80 disabled:opacity-40 md:w-auto"
          >
            {submittingReset ? 'Sending...' : 'Send weekly reset'}
          </button>
        </div>

        <div className="space-y-4">
          <div className="border border-black/10 bg-white p-4 md:p-5">
            <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Body Metrics</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <input type="date" value={metricDraft.measured_at} onChange={(event) => patchMetricDraft({ measured_at: event.target.value })}
                className="col-span-2 border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/35" />
              <input value={metricDraft.weight_kg} onChange={(event) => patchMetricDraft({ weight_kg: event.target.value })}
                inputMode="decimal" className="border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/35" placeholder="Weight kg" />
              <input value={metricDraft.waist_cm} onChange={(event) => patchMetricDraft({ waist_cm: event.target.value })}
                inputMode="decimal" className="border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/35" placeholder="Waist cm" />
              <input value={metricDraft.body_fat_pct} onChange={(event) => patchMetricDraft({ body_fat_pct: event.target.value })}
                inputMode="decimal" className="border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/35" placeholder="Body fat %" />
              <input value={metricDraft.muscle_mass_kg} onChange={(event) => patchMetricDraft({ muscle_mass_kg: event.target.value })}
                inputMode="decimal" className="border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/35" placeholder="Muscle kg" />
              <textarea value={metricDraft.notes} onChange={(event) => patchMetricDraft({ notes: event.target.value })}
                rows={2} className="col-span-2 resize-none border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/35" placeholder="Scale notes or context." />
            </div>
            <button type="button" onClick={() => void submitMetric()} disabled={submittingMetric}
              className="mt-3 w-full border border-black bg-black px-4 py-2 text-sm text-white hover:bg-white hover:text-black disabled:opacity-40">
              {submittingMetric ? 'Saving...' : 'Send metrics'}
            </button>
            {latestMetric && (
              <div className="mt-4 border-t border-black/8 pt-3">
                <p className="text-xs text-black/35">Latest: {formatDate(latestMetric.measured_at)}</p>
                <p className="mt-1 text-sm text-black/60">
                  {formatMetric(latestMetric.weight_kg, 'kg')} · {formatMetric(latestMetric.waist_cm, 'cm')} · {formatMetric(latestMetric.body_fat_pct, '%')}
                </p>
              </div>
            )}
          </div>

          <div className="border border-black/10 bg-white p-4 md:p-5">
            <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Goals</p>
            {goals.length > 0 ? (
              <div className="mt-3 space-y-2">
                {goals.slice(0, 4).map((goal) => (
                  <div key={goal.id} className="border border-black/8 bg-[#fbfbf8] px-3 py-2">
                    <p className="text-sm font-medium">{goal.title}</p>
                    <p className="mt-1 text-xs text-black/45">
                      {getGoalProgressLabel(goal, metrics)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-black/45">Pedro will add agreed goals here.</p>
            )}
          </div>

          <div className="border border-black/10 bg-white p-4 md:p-5">
            <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Progress</p>
            <div className="mt-3 space-y-2">
              <div className="border border-black/8 bg-[#fbfbf8] px-3 py-2">
                <p className="text-xs text-black/35">Weight</p>
                <p className="mt-1 text-sm text-black/65">{renderDelta(weightPair.current?.weight_kg, weightPair.previous?.weight_kg, 'kg')}</p>
              </div>
              <div className="border border-black/8 bg-[#fbfbf8] px-3 py-2">
                <p className="text-xs text-black/35">Waist</p>
                <p className="mt-1 text-sm text-black/65">{renderDelta(waistPair.current?.waist_cm, waistPair.previous?.waist_cm, 'cm')}</p>
              </div>
              <div className="border border-black/8 bg-[#fbfbf8] px-3 py-2">
                <p className="text-xs text-black/35">Monthly adherence</p>
                <p className="mt-1 text-sm text-black/65">
                  {monthlyAdherence.adherencePct === null
                    ? 'No monthly plan yet'
                    : `${monthlyAdherence.adherencePct}% with ${monthlyAdherence.done}/${monthlyAdherence.total} items done`}
                </p>
              </div>
            </div>
          </div>

          <div className="border border-black/10 bg-white p-4 md:p-5">
            <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Monthly Review</p>
            {monthlyReview ? (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-black/35">
                  {formatDate(monthlyReview.period_start)} - {formatDate(monthlyReview.period_end)}
                </p>
                <p className="text-sm leading-relaxed text-black/65">{monthlyReview.client_summary}</p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-black/45">Pedro will share a monthly review here once it is ready.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );

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

        <section className="border border-black/10 bg-white p-4 md:p-5">
          <p className="text-[0.6rem] uppercase tracking-[0.18em] text-black/35">Workout preview</p>
          <h2 className="mt-2 font-display text-2xl font-light md:text-3xl">{selectedDay.title}</h2>
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
      <div className="mx-auto max-w-3xl pb-28">
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
          <h2 className="mt-1 font-display text-2xl font-light md:text-3xl">{selectedDay.title}</h2>
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
                  <div className="border-t border-black/8 px-3 pb-5 pt-1 md:px-4">
                    <div className="space-y-4">
                      {section.exercises.map(({ exercise, values }) => {
                        const count = setCounts[exercise.id] ?? parseSets(values.sets);
                        const history = lastSetsByExercise.get(getExerciseHistoryKey(exercise)) ?? [];
                        const last = history[0] ?? null;
                        const videoId = getYouTubeId(exercise.video_url);
                        const cueKey = `${section.id}-${exercise.id}`;
                        const cuesAreOpen = openCues[cueKey] ?? false;

                        return (
                          <div key={exercise.id} className="border border-black/8 bg-[#fbfbf8] p-3 md:p-4">
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
                            </div>

                            {(videoId || exercise.cues.length > 0) && (
                              <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,16rem)_1fr] md:items-start">
                                {videoId ? (
                                  <button
                                    type="button"
                                    onClick={() => setActiveVideo({ id: videoId, title: exercise.name })}
                                    className="group relative aspect-video overflow-hidden border border-black/10 bg-black text-left"
                                  >
                                    <iframe
                                      title={`${exercise.name} demo`}
                                      src={getYouTubeEmbedUrl(videoId)}
                                      className="h-full w-full pointer-events-none opacity-90 transition-opacity group-hover:opacity-100"
                                      allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                    />
                                    <span className="absolute inset-0 flex items-center justify-center bg-black/20 text-white transition-colors group-hover:bg-black/10">
                                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-black shadow-sm">
                                        <Play className="h-4 w-4 fill-black" />
                                      </span>
                                    </span>
                                  </button>
                                ) : (
                                  <div className="flex aspect-video items-center justify-center border border-black/10 bg-white text-xs text-black/30">
                                    No video added
                                  </div>
                                )}

                                <div>
                                  {exercise.cues.length > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => setOpenCues((current) => ({ ...current, [cueKey]: !cuesAreOpen }))}
                                      className={`flex w-full items-center justify-between border px-3 py-2 text-left text-xs transition-colors ${
                                        cuesAreOpen
                                          ? 'border-black bg-white text-black'
                                          : 'border-black/10 bg-white/60 text-black/45 hover:border-black/25 hover:text-black'
                                      }`}
                                    >
                                      <span>Verbal cues</span>
                                      <ChevronRight className={`h-4 w-4 transition-transform ${cuesAreOpen ? 'rotate-90' : ''}`} />
                                    </button>
                                  )}

                                  {cuesAreOpen && (
                                    <ul className="mt-2 list-disc space-y-1 border border-black/8 bg-white px-6 py-3">
                                      {exercise.cues.slice(0, 5).map((cue) => (
                                        <li key={cue} className="text-xs leading-relaxed text-black/60">
                                          {cue}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              </div>
                            )}

                            {history.length > 0 && (
                              <div className="mt-4 border border-black/8 bg-white px-3 py-2">
                                <p className="text-[0.58rem] uppercase tracking-[0.14em] text-black/30">Last time</p>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {history.slice(0, Math.max(count, history.length)).map((log) => (
                                    <span key={`${log.id}-${log.set_number}`} className="border border-black/8 bg-[#fbfbf8] px-2 py-1 text-xs text-black/50">
                                      Set {log.set_number}: {log.weight ?? '-'}kg x {log.reps ?? '-'}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div className="mt-4 space-y-2">
                              {Array.from({ length: count }).map((_, setIndex) => {
                                const key = draftKey(selectedWorkout.phaseIndex, selectedWorkout.dayIndex, exercise.id, setIndex);
                                const draft = setDrafts[key] ?? { reps: '', weight: '' };
                                return (
                                  <div key={key} className="grid grid-cols-[3.25rem_1fr_1fr] gap-2">
                                    <div className="border border-black/10 bg-white px-2 py-3 text-xs text-black/40">Set {setIndex + 1}</div>
                                    <input
                                      value={draft.weight}
                                      onChange={(event) => updateSetDraft(key, { weight: event.target.value })}
                                      className="min-w-0 border border-black/10 bg-white px-3 py-3 text-sm outline-none focus:border-black/35"
                                      placeholder="Weight"
                                      inputMode="decimal"
                                    />
                                    <input
                                      value={draft.reps}
                                      onChange={(event) => updateSetDraft(key, { reps: event.target.value })}
                                      className="min-w-0 border border-black/10 bg-white px-3 py-3 text-sm outline-none focus:border-black/35"
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
                                onClick={() => addExerciseSet(exercise, count)}
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
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <p className="text-xs text-black/35">
                        {submittedSectionNotes[noteKey] ? 'Sent to Pedro.' : 'Send this without waiting until the end.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => void submitSectionNote(section, noteKey)}
                        disabled={submittingSectionNote === noteKey || !sectionNotes[noteKey]?.trim()}
                        className="border border-black bg-black px-4 py-2 text-xs text-white transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        {submittingSectionNote === noteKey ? 'Sending...' : 'Submit note'}
                      </button>
                    </div>
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

  const renderOverviewScreen = () => (
    <div className="space-y-4 md:space-y-6">
      <div className="mx-auto max-w-5xl">
        <section className="border border-black/10 bg-white p-4 md:p-5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Overview</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
              <p className="text-xs text-black/35">Sessions left</p>
              <p className="mt-1 text-2xl font-light">{client?.sessions_remaining ?? 0}</p>
              <p className="mt-1 text-xs text-black/40">{heldCredits} held by future bookings</p>
            </div>
            <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
              <p className="text-xs text-black/35">Next session</p>
              <p className="mt-1 text-sm font-medium">{nextBooking ? formatBookingDate(nextBooking.start_at) : 'Not booked'}</p>
              <p className="mt-1 text-xs text-black/40">{nextBooking ? formatBookingTime(nextBooking.start_at) : 'Use Tools to book'}</p>
            </div>
            <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
              <p className="text-xs text-black/35">Today</p>
              <p className="mt-1 text-sm font-medium">{dueTodayItems.length > 0 ? `${dueTodayItems.length} item${dueTodayItems.length === 1 ? '' : 's'}` : 'Clear'}</p>
              <p className="mt-1 text-xs text-black/40">{nextPlanItem?.title ?? 'Follow the week plan'}</p>
            </div>
          </div>
        </section>
      </div>

      {renderCoachingHome()}

      <div className="mx-auto max-w-5xl">
        <button
          type="button"
          onClick={() => setActiveScreen('workout')}
          className="group w-full border border-black bg-black p-4 text-left text-white transition-colors hover:bg-white hover:text-black md:p-5"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] opacity-60">Workout</p>
              <h2 className="mt-2 font-display text-2xl font-light">{assignment?.name ?? 'Training programme'}</h2>
              <p className="mt-2 text-sm opacity-65">
                {activePhase ? `Phase ${activePhaseIndex + 1}: ${activePhase.title}` : 'Your programme appears here when Pedro publishes it.'}
              </p>
            </div>
            <Dumbbell className="h-7 w-7 shrink-0 opacity-75 transition-transform group-hover:translate-x-0.5" />
          </div>
        </button>
      </div>
    </div>
  );

  const renderWorkoutHome = () => (
    <div className="space-y-4 md:space-y-6">
      {!assignment || !activePhase ? (
        <div className="mx-auto max-w-5xl border border-black/10 bg-white p-6">
          <p className="text-sm font-medium text-black">
            {client?.name ? `Hi ${client.name.split(' ')[0]}.` : 'Welcome.'}
          </p>
          <p className="mt-2 text-sm text-black/55">
            Your programme is being created. It will appear here as soon as it is live.
          </p>
        </div>
      ) : (
        <div className="mx-auto max-w-5xl space-y-4 md:space-y-6">
          <section className="border border-black/10 bg-white p-4 md:p-5">
            <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Active programme</p>
            <h2 className="mt-2 font-display text-2xl font-light">{assignment.name}</h2>
            {assignment.goal && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-black/55">{assignment.goal}</p>}
          </section>

          <section className="border border-black/10 bg-white p-4 md:p-5">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Phase {activePhaseIndex + 1}</p>
                <h3 className="mt-1 font-display text-2xl font-light md:text-3xl">{activePhase.title}</h3>
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
                    className={`group min-h-[8.5rem] border p-4 text-left transition-colors ${
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
  );

  const renderToolsScreen = () => (
    <div className="mx-auto max-w-5xl space-y-4 md:space-y-6">
      <section className="border border-black/10 bg-white p-4 md:p-5">
        <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Session credits</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
            <p className="text-xs text-black/35">Pack balance</p>
            <p className="mt-1 text-2xl font-light">{client?.sessions_remaining ?? 0}</p>
          </div>
          <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
            <p className="text-xs text-black/35">Held</p>
            <p className="mt-1 text-2xl font-light">{heldCredits}</p>
          </div>
          <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
            <p className="text-xs text-black/35">Available to book</p>
            <p className={`mt-1 text-2xl font-light ${availableCredits === 0 ? 'text-red-600' : ''}`}>{availableCredits}</p>
          </div>
        </div>
      </section>

      <section className="border border-black/10 bg-white p-4 md:p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Book Pedro</p>
            <h2 className="mt-1 font-display text-2xl font-light">Calendar</h2>
          </div>
          <p className="text-xs text-black/40">48 hours to 28 days ahead</p>
        </div>

        {bookableSlots.length === 0 ? (
          <p className="mt-5 border border-dashed border-black/10 py-8 text-center text-sm text-black/40">
            {availableCredits === 0 ? 'You need another pack before booking again.' : 'No slots are currently available.'}
          </p>
        ) : (
          <div className="mt-5">
            <div className="mb-3 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setBookingMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
                className="inline-flex h-9 w-9 items-center justify-center border border-black/10 bg-white text-black/45 hover:border-black/30 hover:text-black"
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <p className="text-sm font-medium">
                {bookingMonth.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}
              </p>
              <button
                type="button"
                onClick={() => setBookingMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
                className="inline-flex h-9 w-9 items-center justify-center border border-black/10 bg-white text-black/45 hover:border-black/30 hover:text-black"
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-7 border-l border-t border-black/10 bg-white">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <div key={day} className="border-b border-r border-black/10 px-2 py-2 text-center text-[0.6rem] uppercase tracking-[0.12em] text-black/35">
                  {day}
                </div>
              ))}
              {calendarDays.map((day) => {
                const key = calendarDateKey(day);
                const daySlots = slotsByDate.get(key) ?? [];
                const inMonth = day.getMonth() === bookingMonth.getMonth();
                return (
                  <div key={key} className={`min-h-28 border-b border-r border-black/10 p-2 ${inMonth ? 'bg-[#fbfbf8]' : 'bg-white text-black/25'}`}>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium">{day.getDate()}</span>
                      {daySlots.some((slot) => slot.available) && <span className="h-1.5 w-1.5 rounded-full bg-green-600" />}
                    </div>
                    <div className="space-y-1">
                      {daySlots.slice(0, 4).map((slot) => (
                        <button
                          key={slot.start_at}
                          type="button"
                          onClick={() => slot.available && setSelectedSlot(slot)}
                          disabled={!slot.available}
                          className={`w-full truncate border px-2 py-1 text-left text-[0.68rem] transition-colors ${
                            selectedSlot?.start_at === slot.start_at
                              ? 'border-black bg-black text-white'
                              : slot.available
                                ? 'border-green-200 bg-white text-black hover:border-black/30'
                                : slot.reason === 'You booked this'
                                  ? 'border-black/10 bg-black text-white'
                                  : 'border-black/5 bg-black/[0.04] text-black/30'
                          }`}
                        >
                          {formatBookingTime(slot.start_at)} {slot.available ? '' : slot.reason === 'You booked this' ? 'Yours' : 'Busy'}
                        </button>
                      ))}
                      {daySlots.length > 4 && <p className="text-[0.65rem] text-black/35">+{daySlots.length - 4} more</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {selectedSlot && (
          <div className="mt-5 border border-black/10 bg-[#fbfbf8] p-4">
            <p className="text-sm font-medium">{selectedSlot.label}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="block">
                <span className="mb-1 block text-xs text-black/45">Repeat weekly</span>
                <select value={recurringWeeks} onChange={(event) => setRecurringWeeks(event.target.value)} className="w-full border border-black/10 bg-white px-3 py-3 text-sm outline-none focus:border-black/35">
                  <option value="1">One session</option>
                  <option value="2">2 weeks</option>
                  <option value="3">3 weeks</option>
                  <option value="4">4 weeks</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => void bookSelectedSlot()}
                disabled={bookingBusy}
                className="inline-flex items-center justify-center gap-2 border border-black bg-black px-5 py-3 text-sm text-white hover:bg-white hover:text-black disabled:opacity-40"
              >
                <CalendarDays className="h-4 w-4" />
                {bookingBusy ? 'Booking...' : 'Confirm'}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="border border-black/10 bg-white p-4 md:p-5">
        <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Upcoming sessions</p>
        <div className="mt-4 space-y-2">
          {activeBookings.length === 0 ? (
            <p className="text-sm text-black/40">No upcoming sessions booked.</p>
          ) : activeBookings.map((booking) => {
            const startsWithin24Hours = new Date(booking.start_at).getTime() - Date.now() < 24 * 60 * 60 * 1000;
            return (
              <div key={booking.id} className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">{formatBookingDate(booking.start_at)} · {formatBookingTime(booking.start_at)}</p>
                    <p className="mt-1 text-xs text-black/40">{pendingCancellationIds.has(booking.id) ? 'Waiting for Pedro to review cancellation' : booking.status.replace(/_/g, ' ')}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void cancelBooking(booking)}
                    disabled={bookingBusy || pendingCancellationIds.has(booking.id)}
                    className="border border-black/10 bg-white px-3 py-2 text-xs text-black/55 hover:border-red-300 hover:text-red-700 disabled:opacity-30"
                  >
                    {startsWithin24Hours ? 'Request cancel' : 'Cancel'}
                  </button>
                </div>
                {startsWithin24Hours && !pendingCancellationIds.has(booking.id) && (
                  <textarea
                    value={bookingReason}
                    onChange={(event) => setBookingReason(event.target.value)}
                    rows={2}
                    className="mt-3 w-full resize-none border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/35"
                    placeholder="Reason for late cancellation."
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );

  const renderActiveScreen = () => {
    if (selectedWorkout?.started) return renderWorkoutLogger();
    if (selectedWorkout) return renderWorkoutPreview();
    if (activeScreen === 'workout') return renderWorkoutHome();
    if (activeScreen === 'tools') return renderToolsScreen();
    return renderOverviewScreen();
  };

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-[#f7f7f3] text-black">
      {renderHeader()}

      <div className="flex-1 overflow-y-auto px-4 py-5 pb-28 md:p-10">
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
        ) : (
          renderActiveScreen()
        )}
      </div>

      {client && (
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white/95 px-4 py-2 shadow-[0_-10px_30px_rgba(0,0,0,0.06)] backdrop-blur">
          <div className="mx-auto grid max-w-sm grid-cols-3 gap-2">
            {([
              ['overview', Home, 'Overview'],
              ['workout', Dumbbell, 'Workout'],
              ['tools', Wrench, 'Tools'],
            ] as const).map(([screen, Icon, label]) => (
              <button
                key={screen}
                type="button"
                onClick={() => {
                  setSelectedWorkout(null);
                  setActiveScreen(screen);
                }}
                className={`flex h-14 flex-col items-center justify-center gap-1 border text-[0.62rem] uppercase tracking-[0.08em] transition-colors ${
                  activeScreen === screen
                    ? 'border-black bg-black text-white'
                    : 'border-transparent text-black/40 hover:border-black/10 hover:text-black'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </nav>
      )}

      {activeVideo && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/95 p-4">
          <div className="w-full max-w-5xl">
            <div className="mb-3 flex items-center justify-between gap-4">
              <p className="truncate text-sm font-medium text-white">{activeVideo.title}</p>
              <button
                type="button"
                onClick={() => setActiveVideo(null)}
                className="inline-flex h-10 w-10 items-center justify-center border border-white/20 text-white transition-colors hover:bg-white hover:text-black"
                aria-label="Close video"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="aspect-video w-full overflow-hidden bg-black">
              <iframe
                key={activeVideo.id}
                title={`${activeVideo.title} full video`}
                src={getYouTubeEmbedUrl(activeVideo.id, true)}
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}

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
