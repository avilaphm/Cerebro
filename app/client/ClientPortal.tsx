'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Dumbbell, Home, Minus, Play, Plus, Salad, Settings, Wrench } from 'lucide-react';
import { computeAdherenceSnapshot, getGoalProgressLabel, latestMetricPair, monthEndInputValue, monthStartInputValue } from '@/utils/pt/coaching';
import { createClient } from '@/utils/supabase/client';
import { safeProgramme, getExerciseBlockValues, requiredWorkoutsForBlock, CANONICAL_SECTION_ORDER } from '@/utils/pt/programme';
import { isPedroAdminEmail } from '@/utils/pt/access';
import {
  ACTIVE_BOOKING_STATUSES,
  PT_BOOKING_HORIZON_DAYS,
  PT_BOOKING_MIN_NOTICE_HOURS,
  PT_BOOKING_TIMEZONE,
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
  PTCheckinSession,
  CheckinWeeklyFocus,
} from '@/utils/pt/types';
import MacroWidget from './MacroWidget';
import MessageBubble from './MessageBubble';
import NutritionTab from './NutritionTab';
import SettingsTab from './SettingsTab';
import WeeklyCheckinModal from './WeeklyCheckinModal';

const PLAN_ITEM_LABELS: Record<PTWeeklyPlanItemType, string> = {
  pt_session: 'PT session',
  solo_strength: 'Solo strength',
  run: 'Run',
  golf_mobility: 'Golf mobility',
  recovery: 'Recovery',
  nutrition: 'Nutrition',
  check_in: 'Check-in',
  pilates: 'Pilates',
  walk: 'Walk',
  fitness_class: 'Fitness class',
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

interface MetricDraft {
  measured_at: string;
  weight_kg: string;
  waist_cm: string;
  body_fat_pct: string;
  muscle_mass_kg: string;
  source: 'manual' | 'scale';
  notes: string;
}

type ClientScreen = 'overview' | 'nutrition' | 'workout' | 'booking' | 'settings';
type BookingCalendarView = '3days' | 'week' | 'month';
const BOOKING_CALENDAR_START_HOUR = 6;
const BOOKING_CALENDAR_END_HOUR = 14;
const BOOKING_HOUR_HEIGHT = 72;
const BOOKING_GRID_TOP_PAD = 20;

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

function startOfWeek(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() - value.getDay());
  return value;
}

function bookingWithin24Hours(booking: PTBookingAppointment) {
  return new Date(booking.start_at).getTime() - Date.now() < 24 * 60 * 60 * 1000;
}

function getNextWeekday(from: Date): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

function advanceWeekday(date: Date, direction: -1 | 1): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + direction);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + direction);
  return d;
}

type ModalStep =
  | null
  | 'slot-book'
  | 'slot-confirm'
  | 'booking-options'
  | 'booking-book-another'
  | 'booking-move'
  | 'booking-move-time'
  | 'booking-move-day'
  | 'booking-cancel';

function getMovableDays(booking: PTBookingAppointment): Date[] {
  const d = new Date(booking.start_at);
  const dow = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  monday.setHours(0, 0, 0, 0);
  if (dow === 5) {
    return [addDays(monday, 7), addDays(monday, 8)];
  }
  return Array.from({ length: 5 }, (_, i) => addDays(monday, i)).filter((day) => day.getDay() !== dow);
}

function calendarOffsetMinutes(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value;
  return (date.getHours() - BOOKING_CALENDAR_START_HOUR) * 60 + date.getMinutes();
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
        const ownBooking = ownBookings.find((booking) =>
          ACTIVE_BOOKING_STATUSES.includes(booking.status) && overlaps(start, end, booking.start_at, booking.end_at),
        );
        slots.push({
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          label: `${formatBookingDate(start)} · ${formatBookingTime(start)}`,
          available: canBook && !taken && !ownBooking,
          booking_id: ownBooking?.id,
          reason: !canBook ? 'No sessions available' : ownBooking ? 'You booked this' : taken ? 'Taken' : undefined,
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
    mute: '1',
    enablejsapi: '1',
    playerapiid: videoId,
  });
  if (typeof window !== 'undefined') params.set('origin', window.location.origin);
  if (autoplay) params.set('autoplay', '1');
  if (autoplay) params.set('loop', '1');
  if (autoplay) params.set('playlist', videoId);
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

  const sectionRank = (title: string): number => {
    if (title === 'Main work') return -1;
    const idx = CANONICAL_SECTION_ORDER.indexOf(title as typeof CANONICAL_SECTION_ORDER[number]);
    return idx >= 0 ? idx : CANONICAL_SECTION_ORDER.length;
  };

  sections.sort((a, b) => sectionRank(a.title) - sectionRank(b.title));

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
  const [bookingAvailability, setBookingAvailability] = useState<PTBookingAvailability[]>([]);
  const [bookings, setBookings] = useState<PTBookingAppointment[]>([]);
  const [bookingBlocks, setBookingBlocks] = useState<PTBookingBlock[]>([]);
  const [cancellationRequests, setCancellationRequests] = useState<PTBookingCancellationRequest[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<PTBookableSlot | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<PTBookingAppointment | null>(null);
  const [movingBookingId, setMovingBookingId] = useState<string | null>(null);
  const [bookingView, setBookingView] = useState<BookingCalendarView>('3days');
  const [bookingDate, setBookingDate] = useState(() => getNextWeekday(new Date()));
  const [nowMs] = useState(() => Date.now());
  const [bookingMonth, setBookingMonth] = useState(() => {
    const date = new Date();
    date.setDate(1);
    return date;
  });
  const [recurringWeeks, setRecurringWeeks] = useState('1');
  const [bookingReason, setBookingReason] = useState('');
  const [modalStep, setModalStep] = useState<ModalStep>(null);
  const [bookAnotherDate, setBookAnotherDate] = useState('');
  const [moveDayTarget, setMoveDayTarget] = useState<string | null>(null);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [checkinSession, setCheckinSession] = useState<PTCheckinSession | null>(null);
  const [checkinFocus, setCheckinFocus] = useState<CheckinWeeklyFocus | null>(null);
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
  const [openCues, setOpenCues] = useState<Record<string, boolean>>({});
  const [openLastTime, setOpenLastTime] = useState<Record<string, boolean>>({});
  const [selectedWorkout, setSelectedWorkout] = useState<SelectedWorkout | null>(null);
  const [activeWorkoutExerciseId, setActiveWorkoutExerciseId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingWorkout, setSavingWorkout] = useState(false);
  const [submittingMetric, setSubmittingMetric] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [progressExpanded, setProgressExpanded] = useState(false);
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
      availabilityRes,
      bookingRes,
      blockRes,
      cancellationRes,
      checkinSessionRes,
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
      supabase
        .from('pt_checkin_sessions')
        .select('*')
        .eq('client_id', currentClient.id)
        .order('week_start', { ascending: false })
        .limit(1),
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
    setBookingAvailability((availabilityRes.data ?? []) as PTBookingAvailability[]);
    setBookings((bookingRes.data ?? []) as PTBookingAppointment[]);
    setBookingBlocks((blockRes.data ?? []) as PTBookingBlock[]);
    setCancellationRequests((cancellationRes.data ?? []) as PTBookingCancellationRequest[]);
    const latestSession = ((checkinSessionRes.data ?? []) as PTCheckinSession[])[0] ?? null;
    setCheckinSession(latestSession);
    if (latestSession?.ai_weekly_focus) setCheckinFocus(latestSession.ai_weekly_focus);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    const id = window.setTimeout(() => { void loadPortal(); }, 0);
    return () => window.clearTimeout(id);
  }, [loadPortal]);

  useEffect(() => {
    if (!selectedWorkout?.started) return;

    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-workout-exercise-id]'));
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      const nextId = (visible?.target as HTMLElement | undefined)?.dataset.workoutExerciseId ?? null;
      if (nextId) setActiveWorkoutExerciseId(nextId);
    }, { threshold: [0.35, 0.55, 0.75] });

    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [selectedWorkout?.started, selectedWorkout?.phaseIndex, selectedWorkout?.dayIndex]);

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
  const nextMondayStr = (() => {
    const now = new Date();
    const day = now.getDay();
    const daysUntilMonday = ((8 - day) % 7) || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() + daysUntilMonday);
    const y = monday.getFullYear();
    const m = String(monday.getMonth() + 1).padStart(2, '0');
    const d = String(monday.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  })();
  const checkinDue = !checkinSession || checkinSession.week_start < nextMondayStr;
  const latestCheckin = weeklyCheckins[0] ?? null;
  const latestMetric = metrics[0] ?? null;
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
  const nextWorkoutDayIndex = activePhase
    ? activePhase.days.findIndex((_, i) => !workoutIsDone(workoutLogs, activePhaseIndex, i, activeProgress))
    : -1;
  const nextWorkoutDay = nextWorkoutDayIndex >= 0 ? (activePhase?.days[nextWorkoutDayIndex] ?? null) : null;
  const activeBookings = useMemo(
    () => bookings.filter((booking) => ACTIVE_BOOKING_STATUSES.includes(booking.status)),
    [bookings],
  );
  const nextBooking = activeBookings.find((booking) => new Date(booking.start_at).getTime() > nowMs) ?? null;
  const heldCredits = activeBookingHoldCount(bookings);
  const availableCredits = availableSessionCredits(client, bookings);
  const bookableSlots = useMemo(
    () => generateBookableSlots(bookingAvailability, bookingBlocks, bookings, availableCredits > 0),
    [availableCredits, bookingAvailability, bookingBlocks, bookings],
  );
  const enrichedBookableSlots = useMemo(() => {
    const byStart = new Map<string, PTBookableSlot>();
    bookableSlots.forEach((slot) => byStart.set(slot.start_at, slot));
    bookableSlots.forEach((slot) => {
      if (slot.booking_id) return;
      const slotStart = new Date(slot.start_at).getTime();
      const slotEnd = new Date(slot.end_at).getTime();
      const match = activeBookings.find((b) => {
        const bs = new Date(b.start_at).getTime();
        const be = new Date(b.end_at).getTime();
        return bs < slotEnd && be > slotStart;
      });
      if (match) {
        byStart.set(slot.start_at, { ...slot, booking_id: match.id, reason: 'You booked this', available: false });
      }
    });
    activeBookings.forEach((booking) => {
      if (new Date(booking.start_at).getTime() <= nowMs) return;
      const covered = Array.from(byStart.values()).some((s) => s.booking_id === booking.id);
      if (covered) return;
      byStart.set(booking.start_at, {
        start_at: booking.start_at,
        end_at: booking.end_at,
        label: `${formatBookingDate(booking.start_at)} · ${formatBookingTime(booking.start_at)}`,
        available: false,
        booking_id: booking.id,
        reason: 'You booked this',
        location: booking.location,
      });
    });
    return Array.from(byStart.values()).sort((a, b) => a.start_at.localeCompare(b.start_at));
  }, [bookableSlots, activeBookings, nowMs]);
  const slotsByDate = useMemo(() => {
    const map = new Map<string, PTBookableSlot[]>();
    enrichedBookableSlots.forEach((slot) => {
      const key = calendarDateKey(slot.start_at);
      map.set(key, [...(map.get(key) ?? []), slot]);
    });
    map.forEach((items) => items.sort((a, b) => a.start_at.localeCompare(b.start_at)));
    return map;
  }, [enrichedBookableSlots]);
  // Mon-Fri only month days
  const calendarDays = useMemo(() => {
    const year = bookingMonth.getFullYear();
    const month = bookingMonth.getMonth();
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const startDay = new Date(first);
    const dow = startDay.getDay();
    startDay.setDate(startDay.getDate() - (dow === 0 ? 6 : dow - 1));
    const endDay = new Date(last);
    const endDow = endDay.getDay();
    endDay.setDate(endDay.getDate() + (endDow === 0 ? 5 : endDow <= 5 ? 5 - endDow : 6));
    const days: Date[] = [];
    const current = new Date(startDay);
    while (current <= endDay) {
      const d = current.getDay();
      if (d >= 1 && d <= 5) days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    return days;
  }, [bookingMonth]);

  // Mon-Fri only week days
  const bookingWeekDays = useMemo(() => {
    const sunday = startOfWeek(bookingDate);
    const monday = addDays(sunday, 1);
    return Array.from({ length: 5 }, (_, i) => addDays(monday, i));
  }, [bookingDate]);

  // Next 3 weekdays starting from bookingDate
  const threeDayDays = useMemo(() => {
    const days: Date[] = [];
    const cursor = new Date(bookingDate);
    while (days.length < 3) {
      if (cursor.getDay() !== 0 && cursor.getDay() !== 6) days.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }, [bookingDate]);
  const bookingById = useMemo(() => {
    const map = new Map<string, PTBookingAppointment>();
    activeBookings.forEach((booking) => map.set(booking.id, booking));
    return map;
  }, [activeBookings]);
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
    getWorkoutSections(day, phase, blockIndex).forEach((section) => {
      section.exercises.forEach(({ exercise, values }) => {
        initialCounts[exercise.id] = parseSets(values.sets);
      });
    });
    setSetCounts((current) => ({ ...initialCounts, ...current }));
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

  const patchMetricDraft = (patch: Partial<MetricDraft>) => {
    setMetricDraft((current) => ({ ...current, ...patch }));
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
        client_id: client?.id,
        start_at: selectedSlot.start_at,
        recurring_weeks: Number(recurringWeeks),
      },
    });

    if (error || data?.error) {
      setStatus(error?.message ?? data?.error ?? 'Could not book session.');
    } else {
      setStatus('Session booked. Check your email for the confirmation.');
      setSelectedSlot(null);
      setModalStep(null);
      await loadPortal();
    }
    setBookingBusy(false);
  };

  const openBookingSlot = (slot: PTBookableSlot) => {
    if (movingBookingId && slot.available) {
      void moveSession(slot);
      return;
    }

    if (slot.booking_id) {
      const found = bookingById.get(slot.booking_id);
      const fallback: PTBookingAppointment = {
        id: slot.booking_id,
        created_at: '',
        client_id: client?.id ?? '',
        start_at: slot.start_at,
        end_at: slot.end_at,
        timezone: PT_BOOKING_TIMEZONE,
        status: 'confirmed',
        source: 'client',
        recurring_group_id: null,
        google_calendar_event_id: null,
        location: slot.location ?? null,
        notes: null,
        cancel_reason: null,
        cancellation_requested_at: null,
        confirmed_at: null,
        completed_at: null,
        completed_by: null,
        cancelled_at: null,
        created_by: null,
      };
      setSelectedBooking(found ?? fallback);
      setSelectedSlot(null);
      setBookingReason('');
      setMovingBookingId(null);
      setModalStep('booking-options');
      return;
    }

    if (!slot.available) return;
    setSelectedSlot(slot);
    setSelectedBooking(null);
    setBookingReason('');
    setMovingBookingId(null);
    setModalStep('slot-book');
  };

  const cancelBooking = async (booking: PTBookingAppointment) => {
    if (bookingBusy) return;
    const startsWithin24Hours = bookingWithin24Hours(booking);
    if (startsWithin24Hours && !bookingReason.trim()) {
      setStatus('Add a reason so Pedro can review the late cancellation.');
      return;
    }

    setBookingBusy(true);
    setStatus(startsWithin24Hours ? 'Sending cancellation request...' : 'Cancelling booking...');
    const { data, error } = await supabase.functions.invoke<{ error?: string; status?: string }>('manage-pt-booking', {
      body: {
        action: 'cancel',
        client_id: client?.id,
        appointment_id: booking.id,
        reason: startsWithin24Hours ? bookingReason.trim() : 'Cancelled by client.',
      },
    });

    if (error || data?.error) {
      setStatus(error?.message ?? data?.error ?? 'Could not cancel booking.');
    } else {
      setBookingReason('');
      setSelectedBooking(null);
      setModalStep(null);
      setStatus(data?.status === 'cancellation_requested' ? 'Pedro has received your cancellation request.' : 'Booking cancelled.');
      await loadPortal();
    }
    setBookingBusy(false);
  };

  const moveSession = async (targetSlot: PTBookableSlot, bookingIdOverride?: string) => {
    const idToMove = bookingIdOverride ?? movingBookingId;
    if (!idToMove || bookingBusy) return;
    setBookingBusy(true);
    setStatus('Moving session...');
    const { error: cancelError } = await supabase.functions.invoke<{ error?: string }>('manage-pt-booking', {
      body: { action: 'cancel', client_id: client?.id, appointment_id: idToMove, reason: 'Moved by client.' },
    });
    if (cancelError) {
      setStatus(cancelError.message ?? 'Could not cancel original session.');
      setBookingBusy(false);
      return;
    }
    const { data, error: bookError } = await supabase.functions.invoke<{ error?: string }>('manage-pt-booking', {
      body: { action: 'create', client_id: client?.id, start_at: targetSlot.start_at, recurring_weeks: 1 },
    });
    if (bookError || data?.error) {
      setStatus(bookError?.message ?? data?.error ?? 'Cancelled original but could not book new slot.');
    } else {
      setStatus('Session moved.');
    }
    setMovingBookingId(null);
    setSelectedBooking(null);
    setSelectedSlot(null);
    setModalStep(null);
    setMoveDayTarget(null);
    setBookingBusy(false);
    await loadPortal();
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

  const DEFAULT_PROGRAMME_PHASES = [
    'Phase 1 - Foundation',
    'Testing 1 RM',
    'Phase 2 - Hypertrophy',
    'Phase 3 - Strength',
    'Re-testing 1 RM',
  ];

  const renderJourneyTimeline = () => {
    const hasProgramme = !!assignment && assignment.programme.phases.length > 0;
    const phaseLabels = hasProgramme
      ? assignment.programme.phases.map((p) => p.title)
      : DEFAULT_PROGRAMME_PHASES;
    const phaseCount = phaseLabels.length;
    const activePi = hasProgramme ? activePhaseIndex : -1;
    const doneFill = hasProgramme && phaseCount > 1
      ? `${(activePi / (phaseCount - 1)) * 100}%`
      : hasProgramme && (phaseProgress[0]?.allBlocksDone ? '100%' : '0%')
        ? hasProgramme ? (phaseProgress[0]?.allBlocksDone ? '100%' : '0%') : '0%'
        : '0%';

    return (
      <div className="mx-auto max-w-5xl">
        <button
          type="button"
          onClick={() => setProgressExpanded((v) => !v)}
          className="w-full border border-black/10 bg-white px-5 py-4 text-left transition-colors hover:bg-[#fcfcfa] md:px-6"
        >
          <div className="flex items-center gap-4">
            <p className="shrink-0 text-[0.6rem] uppercase tracking-[0.15em] text-black/35">Journey</p>
            <div className="relative flex-1">
              <div className="absolute left-0 right-0 top-[0.42rem] h-px bg-black/10" />
              <div
                className="absolute left-0 top-[0.42rem] h-px bg-[rgb(46,213,115)] transition-all"
                style={{ width: doneFill }}
              />
              <div className="relative flex justify-between">
                {phaseLabels.map((label, pi) => {
                  const pp = hasProgramme ? (phaseProgress[pi] ?? null) : null;
                  const isDone = pp?.allBlocksDone ?? false;
                  const isActive = pi === activePi;
                  return (
                    <div key={pi} className="flex flex-col items-center gap-1.5">
                      <div
                        className={`h-3.5 w-3.5 rounded-full border-2 transition-colors ${
                          isDone
                            ? 'border-[rgb(46,213,115)] bg-[rgb(46,213,115)]'
                            : isActive
                              ? 'border-black bg-white'
                              : 'border-black/20 bg-white'
                        }`}
                      />
                      <span className="max-w-[3.5rem] text-center text-[0.44rem] uppercase leading-tight tracking-[0.06em] text-black/35">
                        {label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-black/25 transition-transform ${progressExpanded ? 'rotate-180' : ''}`}
            />
          </div>
        </button>

        {progressExpanded && (
          <div className="space-y-5 border border-t-0 border-black/10 bg-white px-5 py-5 md:px-6">
            {phaseLabels.map((label, pi) => {
              const pp = hasProgramme ? (phaseProgress[pi] ?? null) : null;
              const isDonePhase = pp?.allBlocksDone ?? false;
              const isActivePhase = pi === activePi;
              const blocks = hasProgramme
                ? (assignment.programme.phases[pi]?.week_blocks ?? [])
                : [];

              return (
                <div key={pi}>
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors ${
                        isDonePhase
                          ? 'bg-[rgb(46,213,115)]'
                          : isActivePhase
                            ? 'border-2 border-black bg-white'
                            : 'border-2 border-black/15 bg-white'
                      }`}
                    >
                      {isDonePhase && <Check className="h-2.5 w-2.5 text-white" />}
                    </div>
                    <p
                      className={`text-xs font-medium ${
                        isActivePhase ? 'text-black' : isDonePhase ? 'text-black/60' : 'text-black/30'
                      }`}
                    >
                      {label}
                    </p>
                    {isActivePhase && (
                      <span className="ml-1 text-[0.55rem] uppercase tracking-[0.1em] text-[rgb(46,213,115)]">Current</span>
                    )}
                  </div>

                  {blocks.length > 0 && (
                    <div className="ml-8 mt-3 flex gap-4">
                      {blocks.map((block, bi) => {
                        const blockDone = isDonePhase || (pp !== null && pp.blockIndex > bi);
                        const isActiveBlock = isActivePhase && pp !== null && pp.blockIndex === bi;
                        const blockLabel = block.sets
                          ? `${block.sets} sets`
                          : block.weight_pct
                            ? block.weight_pct
                            : `Block ${bi + 1}`;
                        return (
                          <div key={bi} className="flex flex-col items-center gap-1.5">
                            <div
                              className={`h-2.5 w-2.5 rounded-full transition-colors ${
                                blockDone
                                  ? 'bg-[rgb(46,213,115)]'
                                  : isActiveBlock
                                    ? 'border-[1.5px] border-black/60 bg-transparent'
                                    : 'border border-black/15 bg-transparent'
                              }`}
                            />
                            <span className="max-w-[3rem] text-center text-[0.44rem] uppercase leading-tight tracking-wide text-black/30">
                              {blockLabel}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderBodyMetricsPanel = () => (
    <section className="border border-black/10 bg-white p-5 md:p-6">
      <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Body Metrics</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <input type="date" value={metricDraft.measured_at} onChange={(event) => patchMetricDraft({ measured_at: event.target.value })}
          className="col-span-2 border border-black/10 px-3 py-3 text-[15px] outline-none focus:border-black/35" />
        <input value={metricDraft.weight_kg} onChange={(event) => patchMetricDraft({ weight_kg: event.target.value })}
          inputMode="decimal" className="border border-black/10 px-3 py-3 text-[15px] outline-none focus:border-black/35" placeholder="Weight kg" />
        <input value={metricDraft.waist_cm} onChange={(event) => patchMetricDraft({ waist_cm: event.target.value })}
          inputMode="decimal" className="border border-black/10 px-3 py-3 text-[15px] outline-none focus:border-black/35" placeholder="Waist cm" />
        <input value={metricDraft.body_fat_pct} onChange={(event) => patchMetricDraft({ body_fat_pct: event.target.value })}
          inputMode="decimal" className="border border-black/10 px-3 py-3 text-[15px] outline-none focus:border-black/35" placeholder="Body fat %" />
        <input value={metricDraft.muscle_mass_kg} onChange={(event) => patchMetricDraft({ muscle_mass_kg: event.target.value })}
          inputMode="decimal" className="border border-black/10 px-3 py-3 text-[15px] outline-none focus:border-black/35" placeholder="Muscle kg" />
        <textarea value={metricDraft.notes} onChange={(event) => patchMetricDraft({ notes: event.target.value })}
          rows={2} className="col-span-2 resize-none border border-black/10 px-3 py-3 text-[15px] outline-none focus:border-black/35" placeholder="Scale notes or context." />
      </div>
      <button type="button" onClick={() => void submitMetric()} disabled={submittingMetric}
        className="mt-3 w-full border border-black bg-black px-4 py-3 text-sm text-white hover:bg-white hover:text-black disabled:opacity-40">
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
    </section>
  );

  const renderProgressPanel = () => (
    <section className="border border-black/10 bg-white p-5 md:p-6">
      <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Progress</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
          <p className="text-xs text-black/35">Weight</p>
          <p className="mt-1 text-sm text-black/65">{renderDelta(weightPair.current?.weight_kg, weightPair.previous?.weight_kg, 'kg')}</p>
        </div>
        <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
          <p className="text-xs text-black/35">Waist</p>
          <p className="mt-1 text-sm text-black/65">{renderDelta(waistPair.current?.waist_cm, waistPair.previous?.waist_cm, 'cm')}</p>
        </div>
        <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
          <p className="text-xs text-black/35">Monthly adherence</p>
          <p className="mt-1 text-sm text-black/65">
            {monthlyAdherence.adherencePct === null
              ? 'No monthly plan yet'
              : `${monthlyAdherence.adherencePct}% with ${monthlyAdherence.done}/${monthlyAdherence.total} items done`}
          </p>
        </div>
      </div>
    </section>
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

        <section className="border border-black/10 bg-white p-5 md:p-6">
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
    const exerciseScreens = sections.flatMap((section, sectionIndex) =>
      section.exercises.map((exerciseView, exerciseIndex) => ({
        ...exerciseView,
        section,
        sectionIndex,
        exerciseIndex,
      })),
    );

    return (
      <div className="mx-auto max-w-md pb-28 md:max-w-3xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setSelectedWorkout({ ...selectedWorkout, started: false })}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white/75 text-black/55 backdrop-blur hover:text-black"
            aria-label="Back to workout preview"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 text-right">
            <p className="text-[0.58rem] uppercase tracking-[0.18em] text-black/35">Logging</p>
            <h2 className="truncate font-display text-xl font-light md:text-2xl">{selectedDay.title}</h2>
          </div>
        </div>

        <div className="space-y-6 md:space-y-8">
          {exerciseScreens.map(({ exercise, values, section, exerciseIndex }, screenIndex) => {
            const count = setCounts[exercise.id] ?? parseSets(values.sets);
            const history = lastSetsByExercise.get(getExerciseHistoryKey(exercise)) ?? [];
            const videoId = getYouTubeId(exercise.video_url);
            const cueKey = `${section.id}-${exercise.id}`;
            const lastTimeKey = `${cueKey}-last`;
            const cuesAreOpen = openCues[cueKey] ?? false;
            const lastTimeIsOpen = openLastTime[lastTimeKey] ?? false;
            const nextScreen = exerciseScreens[screenIndex + 1] ?? null;
            const nextVideoId = nextScreen ? getYouTubeId(nextScreen.exercise.video_url) : null;
            const videoIsActive = activeWorkoutExerciseId ? activeWorkoutExerciseId === exercise.id : screenIndex === 0;

            return (
              <section key={exercise.id} data-workout-exercise-id={exercise.id} className="min-h-[calc(100dvh-8rem)] scroll-mt-4">
                <div className="relative overflow-hidden rounded-[2rem] bg-black shadow-[0_24px_70px_rgba(0,0,0,0.16)] md:rounded-[2.25rem]">
                  <div className="relative aspect-[4/5] bg-black md:aspect-video">
                    {videoId && videoIsActive ? (
                      <iframe
                        title={`${exercise.name} demo`}
                        src={getYouTubeEmbedUrl(videoId, true)}
                        className="absolute inset-0 h-full w-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                      />
                    ) : videoId ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-black px-6 text-center text-sm text-white/50">
                        Demo starts as this exercise comes into view
                      </div>
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/45">
                        No video added
                      </div>
                    )}
                    <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4 text-white md:p-5">
                      <div className="rounded-full bg-black/25 px-3 py-1 text-[0.56rem] uppercase tracking-[0.16em] backdrop-blur">
                        {section.title}
                      </div>
                      <div className="rounded-full bg-black/25 px-3 py-1 text-[0.56rem] uppercase tracking-[0.16em] backdrop-blur">
                        {screenIndex + 1}/{exerciseScreens.length}
                      </div>
                    </div>
                  </div>

                  <div className="relative z-10 -mt-9 rounded-t-[2rem] border border-white/70 bg-[#fbfbf8]/95 p-4 shadow-[0_-18px_45px_rgba(0,0,0,0.18)] backdrop-blur md:-mt-12 md:p-5">
                    <div className="mb-4">
                      <p className="text-[0.58rem] uppercase tracking-[0.18em] text-black/35">Exercise {exerciseIndex + 1}</p>
                      <h3 className="mt-1 text-xl font-medium leading-tight text-black md:text-2xl">{exercise.name}</h3>
                      <p className="mt-1 text-sm text-black/45">
                        Target: {values.sets || '?'} sets - {values.reps || '?'} reps
                        {exercise.rest ? ` - ${exercise.rest}` : ''}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => setOpenCues((current) => ({ ...current, [cueKey]: !cuesAreOpen }))}
                        className="flex w-full items-center justify-between rounded-full border border-black/10 bg-white/85 px-4 py-3 text-left text-sm text-black/65 shadow-sm transition-colors hover:border-black/25 hover:text-black"
                      >
                        <span>Verbal cues</span>
                        <ChevronRight className={`h-5 w-5 text-black/45 transition-transform ${cuesAreOpen ? 'rotate-90' : ''}`} />
                      </button>

                      {cuesAreOpen && (
                        <ul className="rounded-[1.35rem] border border-black/8 bg-white/80 px-6 py-4">
                          {(exercise.cues.length > 0 ? exercise.cues : ['Move with control', 'Keep the target muscles loaded', 'Use a range you can own', 'Stop if pain changes your form']).slice(0, 4).map((cue) => (
                            <li key={cue} className="list-disc text-sm leading-relaxed text-black/60">
                              {cue}
                            </li>
                          ))}
                        </ul>
                      )}

                      <button
                        type="button"
                        onClick={() => setOpenLastTime((current) => ({ ...current, [lastTimeKey]: !lastTimeIsOpen }))}
                        className="flex w-full items-center justify-between rounded-full border border-black/10 bg-white/85 px-4 py-3 text-left text-sm text-black/65 shadow-sm transition-colors hover:border-black/25 hover:text-black"
                      >
                        <span>Last time</span>
                        <ChevronRight className={`h-5 w-5 text-black/45 transition-transform ${lastTimeIsOpen ? 'rotate-90' : ''}`} />
                      </button>

                      {lastTimeIsOpen && (
                        <div className="rounded-[1.35rem] border border-black/8 bg-white/80 px-4 py-4">
                          {history.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {history.slice(0, Math.max(count, history.length)).map((log) => (
                                <span key={`${log.id}-${log.set_number}`} className="rounded-full border border-black/8 bg-[#fbfbf8] px-3 py-2 text-xs text-black/55">
                                  Set {log.set_number}: {log.weight ?? '-'}kg x {log.reps ?? '-'}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-black/40">No previous sets logged for this exercise yet.</p>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="mt-5 space-y-3">
                      {Array.from({ length: count }).map((_, setIndex) => {
                        const key = draftKey(selectedWorkout.phaseIndex, selectedWorkout.dayIndex, exercise.id, setIndex);
                        const draft = setDrafts[key] ?? { reps: '', weight: '' };
                        return (
                          <div key={key} className="grid grid-cols-[4.5rem_1fr_1fr] gap-2 md:grid-cols-[5rem_1fr_1fr]">
                            <div className="flex h-16 items-center rounded-[1.35rem] border border-black/10 bg-white/80 px-3 text-sm text-black/45">
                              Set {setIndex + 1}
                            </div>
                            <input
                              value={draft.weight}
                              onChange={(event) => updateSetDraft(key, { weight: event.target.value })}
                              className="min-w-0 rounded-[1.35rem] border border-black/10 bg-white/80 px-4 text-lg outline-none focus:border-black/35"
                              placeholder="Weight"
                              inputMode="decimal"
                            />
                            <input
                              value={draft.reps}
                              onChange={(event) => updateSetDraft(key, { reps: event.target.value })}
                              className="min-w-0 rounded-[1.35rem] border border-black/10 bg-white/80 px-4 text-lg outline-none focus:border-black/35"
                              placeholder="Reps"
                              inputMode="decimal"
                            />
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-4 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setExerciseCount(exercise.id, count - 1)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white/80 text-black/45 hover:border-black/30 hover:text-black disabled:opacity-30"
                        disabled={count <= 1}
                        aria-label="Remove set"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => addExerciseSet(exercise, count)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white/80 text-black/45 hover:border-black/30 hover:text-black"
                        aria-label="Add set"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {nextScreen && (
                  <div className="mx-2 mt-4 rounded-[1.5rem] border border-black/10 bg-black px-4 py-4 text-white shadow-[0_18px_45px_rgba(0,0,0,0.16)]">
                    <p className="text-[0.58rem] uppercase tracking-[0.18em] text-white/45">Next exercise</p>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-white/10">
                        {nextVideoId ? (
                          <img
                            src={`https://img.youtube.com/vi/${nextVideoId}/hqdefault.jpg`}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <Dumbbell className="h-5 w-5 text-white/40" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{nextScreen.exercise.name}</p>
                        <p className="mt-1 text-xs text-white/45">{nextScreen.section.title}</p>
                      </div>
                      <ChevronDown className="ml-auto h-5 w-5 shrink-0 text-white/45" />
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <div className="mt-6 space-y-3 rounded-[1.75rem] border border-black/10 bg-white/85 p-4 shadow-sm backdrop-blur">
          <p className="text-[0.6rem] uppercase tracking-[0.18em] text-black/35">Notes for Pedro</p>
          {sections.map((section) => {
            const noteKey = sectionNoteKey(selectedWorkout.phaseIndex, selectedWorkout.dayIndex, section.id);
            return (
              <div key={section.id} className="border-t border-black/8 pt-3 first:border-t-0 first:pt-0">
                <label className="block">
                  <span className="text-xs font-medium text-black/45">{section.title}</span>
                  <textarea
                    value={sectionNotes[noteKey] ?? ''}
                    onChange={(event) => setSectionNotes((current) => ({ ...current, [noteKey]: event.target.value }))}
                    rows={3}
                    className="mt-2 w-full resize-none rounded-[1.25rem] border border-black/10 bg-[#fbfbf8] px-3 py-3 text-sm outline-none focus:border-black/35"
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
                    className="rounded-full border border-black bg-black px-4 py-2 text-xs text-white transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    {submittingSectionNote === noteKey ? 'Sending...' : 'Submit note'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => void finishWorkout()}
          disabled={savingWorkout}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-black px-5 py-4 text-sm font-medium text-white transition-colors hover:bg-black/80 disabled:cursor-wait disabled:opacity-50"
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
        <section className="border border-black/10 bg-white p-5 md:p-6">
          <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Overview</p>
          <div className="mt-4">
            <p className="text-[0.6rem] uppercase tracking-[0.14em] text-black/35">This Week&apos;s Focus</p>
            <h2 className="mt-1 font-display text-2xl font-light">
              {formatWeekRange(currentWeeklyPlan?.week_start ?? currentWeekStart)}
            </h2>
            {currentWeeklyPlan?.client_note ? (
              <p className="mt-2 text-sm leading-relaxed text-black/60">{currentWeeklyPlan.client_note}</p>
            ) : (
              <p className="mt-2 text-sm leading-relaxed text-black/45">
                {currentWeeklyPlan
                  ? 'Week is set. Check the plan below.'
                  : 'Send Pedro the shape of your week before he adjusts training, running, mobility, and nutrition.'}
              </p>
            )}
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
              <p className="text-[0.6rem] uppercase tracking-[0.14em] text-black/35">Next session</p>
              <p className="mt-1.5 text-sm font-medium">{nextBooking ? formatBookingDate(nextBooking.start_at) : 'Not booked'}</p>
              {nextBooking
                ? <p className="mt-0.5 text-xs text-black/40">{formatBookingTime(nextBooking.start_at)}</p>
                : <p className="mt-0.5 text-xs text-black/40">Use Tools to book</p>}
            </div>
            <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
              <p className="text-[0.6rem] uppercase tracking-[0.14em] text-black/35">Due today</p>
              <p className="mt-1.5 text-sm font-medium">
                {dueTodayItems.length > 0 ? `${dueTodayItems.length} item${dueTodayItems.length === 1 ? '' : 's'}` : 'Clear'}
              </p>
              {dueTodayItems.length > 0 && (
                <p className="mt-0.5 text-xs text-black/40">{dueTodayItems[0].title}</p>
              )}
            </div>
            <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
              <p className="text-[0.6rem] uppercase tracking-[0.14em] text-black/35">Next workout</p>
              <p className="mt-1.5 text-sm font-medium">{nextWorkoutDay?.title ?? 'All done'}</p>
              {nextWorkoutDay && activePhase && (
                <p className="mt-0.5 text-xs text-black/40">Phase {activePhaseIndex + 1}</p>
              )}
            </div>
          </div>
        </section>
      </div>

      {client && (
        <div className="mx-auto max-w-5xl">
          <MacroWidget clientId={client.id} onNutritionTabOpen={() => setActiveScreen('nutrition')} />
        </div>
      )}

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

      {currentWeeklyPlan && (
        <div className="mx-auto max-w-5xl">
          <section className="border border-black/10 bg-white">
            <button
              type="button"
              onClick={() => setPlanOpen((prev) => !prev)}
              className="flex w-full items-center justify-between gap-3 p-5 text-left md:p-6"
            >
              <div className="flex items-center gap-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Plan</p>
                <p className="text-xs text-black/35">
                  {currentWeeklyPlanItems.filter((item) => item.status === 'done').length}/{currentWeeklyPlanItems.length} done
                </p>
              </div>
              <ChevronRight className={`h-5 w-5 shrink-0 text-black/35 transition-transform ${planOpen ? 'rotate-90' : ''}`} />
            </button>
            {planOpen && (
              <div className="border-t border-black/8 px-5 pb-5 md:px-6 md:pb-6">
                {currentWeeklyPlanItems.length === 0 ? (
                  <p className="pt-4 text-sm text-black/45">Pedro has published the week, but no items are listed yet.</p>
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
              </div>
            )}
          </section>
        </div>
      )}

      {checkinFocus && (
        <div className="mx-auto max-w-5xl">
          <section className="border border-black/10 bg-white p-5 md:p-6">
            <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">This Week&apos;s Focus</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="border border-black/8 bg-[#fbfbf8] p-3">
                <p className="text-[0.6rem] uppercase tracking-[0.14em] text-black/35">Exercise</p>
                <p className="mt-2 text-sm leading-relaxed">{checkinFocus.exercise}</p>
              </div>
              <div className="border border-black/8 bg-[#fbfbf8] p-3">
                <p className="text-[0.6rem] uppercase tracking-[0.14em] text-black/35">Nutrition</p>
                <p className="mt-2 text-sm leading-relaxed">{checkinFocus.nutrition}</p>
              </div>
              <div className="border border-black/8 bg-[#fbfbf8] p-3">
                <p className="text-[0.6rem] uppercase tracking-[0.14em] text-black/35">Sleep</p>
                <p className="mt-2 text-sm leading-relaxed">{checkinFocus.sleep}</p>
              </div>
            </div>
          </section>
        </div>
      )}

      <div className="mx-auto max-w-5xl">
        <div className="border border-black/10 bg-white p-5 md:p-6">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Goals</p>
            {checkinDue && (
              <span className="animate-pulse border border-amber-300 bg-amber-50 px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.1em] text-amber-700">
                Check-in due
              </span>
            )}
          </div>
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
          <button
            type="button"
            onClick={() => setShowCheckinModal(true)}
            className={`mt-4 w-full px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-black/80 ${
              checkinDue ? 'bg-black' : 'bg-black/60'
            }`}
          >
            Weekly Check-in
          </button>
        </div>
      </div>
    </div>
  );

  const renderWorkoutHome = () => (
    <div className="space-y-4 md:space-y-6">
      {!assignment || !activePhase ? (
        <div className="mx-auto max-w-5xl space-y-4 md:space-y-6">
          <div className="border border-black/10 bg-white p-6">
            <p className="text-sm font-medium text-black">
              {client?.name ? `Hi ${client.name.split(' ')[0]}.` : 'Welcome.'}
            </p>
            <p className="mt-2 text-sm text-black/55">
              Your programme is being created. It will appear here as soon as it is live.
            </p>
          </div>
          {renderJourneyTimeline()}
        </div>
      ) : (
        <div className="mx-auto max-w-5xl space-y-4 md:space-y-6">
          <section className="border border-black/10 bg-white p-5 md:p-6">
            <h2 className="font-display text-2xl font-light">{assignment.name}</h2>
            {assignment.goal && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-black/55">{assignment.goal}</p>}
          </section>

          <section className="border border-black/10 bg-white p-5 md:p-6">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Phase {activePhaseIndex + 1}</p>
                <h3 className="mt-1 font-display text-2xl font-light md:text-3xl">{activePhase.title}</h3>
                {activePhase.focus && <p className="mt-2 text-sm text-black/50">{activePhase.focus}</p>}
              </div>
              {activePhase.progression && <p className="max-w-md text-sm leading-relaxed text-black/45">{activePhase.progression}</p>}
            </div>

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
                    className={`group relative min-h-[8.5rem] overflow-hidden border p-4 text-left transition-colors ${
                      done
                        ? 'border-[rgba(46,213,115,0.3)] bg-white shadow-[0_6px_30px_4px_rgba(46,213,115,0.45),0_16px_48px_-4px_rgba(46,213,115,0.3)] after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(90deg,transparent,rgba(46,213,115,1),transparent)] hover:border-[rgba(46,213,115,0.45)]'
                        : 'border-black/10 bg-[#fbfbf8] hover:border-black/35 hover:bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[0.6rem] uppercase tracking-[0.16em] text-black/35">Workout {dayIndex + 1}</p>
                        <h4 className="mt-2 text-lg font-medium">{day.title}</h4>
                      </div>
                      {done ? (
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-black text-white shadow-[0_0_18px_rgba(46,213,115,0.4)]">
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

          {renderJourneyTimeline()}
        </div>
      )}
    </div>
  );

  const renderBookingScreen = () => {
    const title =
      bookingView === '3days'
        ? `${formatBookingDate(threeDayDays[0])} - ${formatBookingDate(threeDayDays[2])}`
        : bookingView === 'week'
          ? `${formatBookingDate(bookingWeekDays[0])} - ${formatBookingDate(bookingWeekDays[4])}`
          : bookingMonth.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });

    const closeModal = () => {
      setModalStep(null);
      setSelectedSlot(null);
      setSelectedBooking(null);
      setBookingReason('');
      setMoveDayTarget(null);
    };

    const moveCalendar = (direction: -1 | 1) => {
      setSelectedSlot(null);
      setSelectedBooking(null);
      setBookingReason('');
      setMovingBookingId(null);
      if (bookingView === 'month') {
        setBookingMonth((current) => new Date(current.getFullYear(), current.getMonth() + direction, 1));
        return;
      }
      if (bookingView === 'week') {
        setBookingDate((current) => addDays(current, direction * 7));
        return;
      }
      setBookingDate((current) => advanceWeekday(current, direction));
    };

    const renderCalendarSlot = (slot: PTBookableSlot, compact = false) => {
      const duration = Math.max(25, (new Date(slot.end_at).getTime() - new Date(slot.start_at).getTime()) / 60000);
      const top = Math.max(0, (calendarOffsetMinutes(slot.start_at) / 60) * BOOKING_HOUR_HEIGHT);
      const height = Math.max(34, (duration / 60) * BOOKING_HOUR_HEIGHT);
      const isOwn = slot.reason === 'You booked this';

      return (
        <button
          key={slot.start_at}
          type="button"
          onClick={() => openBookingSlot(slot)}
          disabled={!slot.available && !isOwn}
          style={{ top, height }}
          className={`absolute inset-x-1 overflow-hidden border px-2 py-1 text-left transition-colors ${
            isOwn
              ? 'border-blue-500 bg-blue-500 text-white hover:bg-blue-600'
              : slot.available
                ? 'border-black/12 bg-white text-black shadow-[0_12px_22px_-20px_rgba(0,0,0,0.55)] hover:border-black/35'
                : 'border-black/6 bg-black/[0.08] text-black/35'
          }`}
        >
          <span className={`block truncate font-medium ${compact ? 'text-[0.72rem]' : 'text-sm'}`}>
            {isOwn ? (client?.name ?? 'Booked') : slot.available ? 'Available' : 'Busy'}
          </span>
          {!compact && (
            <span className="mt-0.5 block truncate text-xs opacity-80">
              {formatBookingTime(slot.start_at)} - {formatBookingTime(slot.end_at)}
            </span>
          )}
        </button>
      );
    };

    const renderCalendarRail = (days: Date[], scrollable = true) => {
      const body = (
        <div className={scrollable ? 'min-w-[44rem]' : undefined}>
          <div className="grid border-b border-black/10" style={{ gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))` }}>
            <div className="bg-[#fbfbf8]" />
            {days.map((day) => {
              const isToday = calendarDateKey(day) === todayInputValue();
              return (
                <div key={calendarDateKey(day)} className="border-l border-black/10 bg-[#fbfbf8] px-3 py-3 text-center">
                  <p className="text-[0.65rem] uppercase tracking-[0.12em] text-black/35">{day.toLocaleDateString('en-AU', { weekday: 'short' })}</p>
                  <p className={`mx-auto mt-1 flex h-8 w-8 items-center justify-center rounded-full text-lg font-light ${isToday ? 'bg-black text-white' : 'text-black/70'}`}>
                    {day.getDate()}
                  </p>
                </div>
              );
            })}
          </div>
          <div
            className="grid"
            style={{
              gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))`,
              height: (BOOKING_CALENDAR_END_HOUR - BOOKING_CALENDAR_START_HOUR) * BOOKING_HOUR_HEIGHT + BOOKING_GRID_TOP_PAD,
              paddingTop: BOOKING_GRID_TOP_PAD,
            }}
          >
            <div className="relative bg-white">
              {Array.from({ length: BOOKING_CALENDAR_END_HOUR - BOOKING_CALENDAR_START_HOUR + 1 }, (_, index) => {
                const hour = BOOKING_CALENDAR_START_HOUR + index;
                return (
                  <div key={hour} className="absolute right-2 -translate-y-1/2 text-xs text-black/35" style={{ top: index * BOOKING_HOUR_HEIGHT }}>
                    {new Date(2026, 0, 1, hour).toLocaleTimeString('en-AU', { hour: 'numeric' })}
                  </div>
                );
              })}
            </div>
            {days.map((day) => {
              const key = calendarDateKey(day);
              const allDaySlots = slotsByDate.get(key) ?? [];
              const daySlots = movingBookingId
                ? allDaySlots.filter((s) => s.available)
                : allDaySlots;
              return (
                <div key={key} className="relative border-l border-black/10">
                  {Array.from({ length: BOOKING_CALENDAR_END_HOUR - BOOKING_CALENDAR_START_HOUR + 1 }, (_, index) => (
                    <div key={index} className="absolute inset-x-0 border-t border-black/10" style={{ top: index * BOOKING_HOUR_HEIGHT }} />
                  ))}
                  {daySlots.map((slot) => renderCalendarSlot(slot, days.length > 1))}
                </div>
              );
            })}
          </div>
        </div>
      );
      return (
        <div className={`mt-5 border border-black/10 bg-white ${scrollable ? 'overflow-x-auto' : ''}`}>
          {body}
        </div>
      );
    };

    const renderMonthSlot = (slot: PTBookableSlot) => {
      const isOwn = slot.reason === 'You booked this';
      return (
        <button
          key={slot.start_at}
          type="button"
          onClick={() => openBookingSlot(slot)}
          disabled={!slot.available && !isOwn}
          className={`w-full truncate px-2 py-1 text-left text-[0.68rem] font-medium ${
            isOwn
              ? 'bg-blue-500 text-white'
              : slot.available
                ? 'bg-white text-black'
                : 'bg-black/[0.08] text-black/35'
          }`}
        >
          {formatBookingTime(slot.start_at)} {isOwn ? (client?.name ?? 'Booked') : slot.available ? 'Open' : 'Busy'}
        </button>
      );
    };

    return (
      <div className="mx-auto max-w-5xl space-y-4 md:space-y-6">
        <section className="border border-black/10 bg-white p-5 md:p-6">
          <div className="grid gap-3 sm:grid-cols-[1.2fr_0.8fr]">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Next session</p>
              <h2 className="mt-1 font-display text-2xl font-light">
                {nextBooking ? formatBookingDate(nextBooking.start_at) : 'Nothing booked'}
              </h2>
              <p className="mt-1 text-sm text-black/50">
                {nextBooking ? `${formatBookingTime(nextBooking.start_at)} at ${nextBooking.location ?? 'the gym'}` : 'Pick a slot below when you are ready.'}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
                <p className="text-xs text-black/35">Pack</p>
                <p className="mt-1 text-2xl font-light">{client?.sessions_remaining ?? 0}</p>
              </div>
              <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
                <p className="text-xs text-black/35">Held</p>
                <p className="mt-1 text-2xl font-light">{heldCredits}</p>
              </div>
              <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
                <p className="text-xs text-black/35">Open</p>
                <p className={`mt-1 text-2xl font-light ${availableCredits === 0 ? 'text-red-600' : ''}`}>{availableCredits}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="border border-black/10 bg-white p-5 md:p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Book Pedro</p>
              <h2 className="mt-1 font-display text-2xl font-light">Calendar</h2>
            </div>
            <div className="inline-grid grid-cols-3 border border-black/10 bg-[#fbfbf8] p-1">
              {(['3days', 'week', 'month'] as BookingCalendarView[]).map((view) => (
                <button
                  key={view}
                  type="button"
                  onClick={() => {
                    setBookingView(view);
                    setSelectedSlot(null);
                    setSelectedBooking(null);
                    setMovingBookingId(null);
                  }}
                  className={`px-3 py-2 text-xs font-medium uppercase tracking-[0.08em] transition-colors ${
                    bookingView === view ? 'bg-black text-white' : 'text-black/45 hover:text-black'
                  }`}
                >
                  {view === '3days' ? '3 days' : view}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => moveCalendar(-1)}
              className="inline-flex h-10 w-10 items-center justify-center border border-black/10 bg-white text-black/45 hover:border-black/30 hover:text-black"
              aria-label="Previous calendar range"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <p className="text-center text-sm font-medium">{title}</p>
            <button
              type="button"
              onClick={() => moveCalendar(1)}
              className="inline-flex h-10 w-10 items-center justify-center border border-black/10 bg-white text-black/45 hover:border-black/30 hover:text-black"
              aria-label="Next calendar range"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {movingBookingId && (
            <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Pick an available slot below to move your session. Only slots within the same week are shown.{' '}
              <button type="button" onClick={() => setMovingBookingId(null)} className="underline underline-offset-2 hover:no-underline">
                Cancel move
              </button>
            </p>
          )}

          {bookableSlots.length === 0 ? (
            <p className="mt-5 border border-dashed border-black/10 py-8 text-center text-sm text-black/40">
              {availableCredits === 0 ? 'You need another pack before booking again.' : 'No slots are currently available.'}
            </p>
          ) : bookingView === '3days' ? (
            renderCalendarRail(threeDayDays, false)
          ) : bookingView === 'week' ? (
            renderCalendarRail(bookingWeekDays)
          ) : (() => {
            const todayStr = todayInputValue();
            const isCurrentMonth =
              bookingMonth.getMonth() === new Date().getMonth() &&
              bookingMonth.getFullYear() === new Date().getFullYear();
            return (
              <div className="mt-5 grid grid-cols-5 border-l border-t border-black/10 bg-white">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((day) => (
                  <div key={day} className="border-b border-r border-black/10 px-2 py-2 text-center text-[0.6rem] uppercase tracking-[0.12em] text-black/35">
                    {day}
                  </div>
                ))}
                {calendarDays.flatMap((day, index) => {
                  const key = calendarDateKey(day);
                  const isPast = isCurrentMonth && calendarDateKey(day) < todayStr;
                  const inMonth = day.getMonth() === bookingMonth.getMonth();
                  const daySlots = isPast ? [] : (slotsByDate.get(key) ?? []);
                  const cell = (
                    <div key={key} className={`min-h-28 border-b border-r border-black/10 p-2 ${
                      isPast ? 'bg-white opacity-30' : inMonth ? 'bg-[#fbfbf8]' : 'bg-white text-black/25'
                    }`}>
                      <span className="text-xs font-medium">{day.getDate()}</span>
                      {!isPast && (
                        <div className="mt-2 space-y-1">
                          {daySlots.slice(0, 4).map(renderMonthSlot)}
                          {daySlots.length > 4 && <p className="text-[0.65rem] text-black/35">+{daySlots.length - 4} more</p>}
                        </div>
                      )}
                    </div>
                  );
                  if ((index + 1) % 5 === 0 && index < calendarDays.length - 1) {
                    return [
                      cell,
                      <div key={`weekend-${index}`} className="col-span-5 flex items-center border-b border-r border-black/10 bg-black/[0.018] px-4 py-[5px]">
                        <div className="h-px flex-1 bg-black/10" />
                        <span className="mx-3 text-[0.5rem] uppercase tracking-[0.2em] text-black/20">Sat &middot; Sun</span>
                        <div className="h-px flex-1 bg-black/10" />
                      </div>,
                    ];
                  }
                  return [cell];
                })}
              </div>
            );
          })()}

        </section>

        {/* Booking modal overlay */}
        {modalStep && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-[2px] sm:items-center sm:p-4"
            onClick={closeModal}
          >
            <div
              className="w-full max-w-sm overflow-hidden bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Available slot: step 1 */}
              {modalStep === 'slot-book' && selectedSlot && (
                <div className="p-6">
                  <p className="text-[0.6rem] uppercase tracking-[0.18em] text-black/35">Available slot</p>
                  <h3 className="mt-1 text-xl font-medium">{formatBookingDate(selectedSlot.start_at)}</h3>
                  <p className="mt-1 text-sm text-black/55">
                    {formatBookingTime(selectedSlot.start_at)} - {formatBookingTime(selectedSlot.end_at)}{selectedSlot.location ? ` · ${selectedSlot.location}` : ''}
                  </p>
                  <div className="mt-6 space-y-2">
                    <button type="button" onClick={() => setModalStep('slot-confirm')} className="w-full bg-black py-3 text-sm font-medium text-white hover:bg-black/85">
                      Book session
                    </button>
                    <button type="button" onClick={closeModal} className="w-full border border-black/10 py-3 text-sm text-black/50 hover:text-black">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Available slot: step 2 — confirm */}
              {modalStep === 'slot-confirm' && selectedSlot && (
                <div className="p-6">
                  <p className="text-[0.6rem] uppercase tracking-[0.18em] text-black/35">Confirm booking</p>
                  <h3 className="mt-1 text-xl font-medium">{formatBookingDate(selectedSlot.start_at)}</h3>
                  <p className="mt-1 text-sm text-black/55">
                    {formatBookingTime(selectedSlot.start_at)} - {formatBookingTime(selectedSlot.end_at)}{selectedSlot.location ? ` · ${selectedSlot.location}` : ''}
                  </p>
                  <label className="mt-4 block">
                    <span className="mb-1 block text-[0.62rem] uppercase tracking-[0.13em] text-black/35">Repeat weekly</span>
                    <select value={recurringWeeks} onChange={(e) => setRecurringWeeks(e.target.value)} className="w-full border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/35">
                      <option value="1">One session</option>
                      <option value="2">2 weeks</option>
                      <option value="3">3 weeks</option>
                      <option value="4">4 weeks</option>
                    </select>
                  </label>
                  <div className="mt-5 space-y-2">
                    <button type="button" onClick={() => void bookSelectedSlot()} disabled={bookingBusy} className="w-full bg-black py-3 text-sm font-medium text-white hover:bg-black/85 disabled:opacity-40">
                      {bookingBusy ? 'Booking...' : 'Confirm booking'}
                    </button>
                    <button type="button" onClick={() => setModalStep('slot-book')} className="w-full border border-black/10 py-3 text-sm text-black/50 hover:text-black">
                      Back
                    </button>
                  </div>
                </div>
              )}

              {/* Owned booking: options menu */}
              {modalStep === 'booking-options' && selectedBooking && (
                <div className="p-6">
                  <p className="text-[0.6rem] uppercase tracking-[0.18em] text-black/35">Your session</p>
                  <h3 className="mt-1 text-xl font-medium">{formatBookingDate(selectedBooking.start_at)}</h3>
                  <p className="mt-1 text-sm text-black/55">
                    {formatBookingTime(selectedBooking.start_at)} - {formatBookingTime(selectedBooking.end_at)}{selectedBooking.location ? ` · ${selectedBooking.location}` : ''}
                  </p>
                  {pendingCancellationIds.has(selectedBooking.id) && (
                    <p className="mt-3 text-xs text-amber-600">Cancellation request sent. Waiting for Pedro to review.</p>
                  )}
                  <div className="mt-5 space-y-2">
                    <button
                      type="button"
                      onClick={() => { setBookAnotherDate(calendarDateKey(getNextWeekday(new Date()))); setModalStep('booking-book-another'); }}
                      className="flex w-full items-center justify-between border border-black/10 px-4 py-3 text-sm text-black hover:border-black/30"
                    >
                      Book another session <ChevronRight className="h-4 w-4 text-black/35" />
                    </button>
                    {!pendingCancellationIds.has(selectedBooking.id) && (
                      <button
                        type="button"
                        onClick={() => setModalStep('booking-move')}
                        className="flex w-full items-center justify-between border border-black/10 px-4 py-3 text-sm text-black hover:border-black/30"
                      >
                        Move this session <ChevronRight className="h-4 w-4 text-black/35" />
                      </button>
                    )}
                    {!pendingCancellationIds.has(selectedBooking.id) && (
                      <button
                        type="button"
                        onClick={() => setModalStep('booking-cancel')}
                        className="flex w-full items-center justify-between border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 hover:bg-red-100"
                      >
                        Cancel this session <ChevronRight className="h-4 w-4 text-red-400" />
                      </button>
                    )}
                  </div>
                  <button type="button" onClick={closeModal} className="mt-3 w-full py-2 text-xs text-black/35 hover:text-black">
                    Close
                  </button>
                </div>
              )}

              {/* Book another session */}
              {modalStep === 'booking-book-another' && (
                <div className="p-6">
                  <p className="text-[0.6rem] uppercase tracking-[0.18em] text-black/35">Book another session</p>
                  <label className="mt-4 block">
                    <span className="mb-1 block text-[0.62rem] uppercase tracking-[0.13em] text-black/35">Date (weekdays only)</span>
                    <input
                      type="date"
                      value={bookAnotherDate}
                      min={calendarDateKey(getNextWeekday(new Date()))}
                      onChange={(e) => setBookAnotherDate(e.target.value)}
                      className="w-full border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/35"
                    />
                  </label>
                  <div className="mt-4 max-h-48 overflow-y-auto">
                    {(() => {
                      const slots = (slotsByDate.get(bookAnotherDate) ?? []).filter((s) => s.available);
                      if (!bookAnotherDate) return <p className="text-sm text-black/40">Pick a date above.</p>;
                      if (slots.length === 0) return <p className="text-sm text-black/40">No available slots for this date.</p>;
                      return (
                        <div className="space-y-1">
                          {slots.map((slot) => (
                            <button
                              key={slot.start_at}
                              type="button"
                              onClick={() => { setSelectedSlot(slot); setModalStep('slot-confirm'); }}
                              className="flex w-full items-center justify-between border border-black/10 px-4 py-2.5 text-sm hover:border-black/30 hover:bg-[#fbfbf8]"
                            >
                              <span>{formatBookingTime(slot.start_at)} - {formatBookingTime(slot.end_at)}</span>
                              {slot.location && <span className="text-xs text-black/40">{slot.location}</span>}
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                  <button type="button" onClick={() => setModalStep('booking-options')} className="mt-4 w-full border border-black/10 py-3 text-sm text-black/50 hover:text-black">
                    Back
                  </button>
                </div>
              )}

              {/* Move: choose same-day or other-day */}
              {modalStep === 'booking-move' && selectedBooking && (
                <div className="p-6">
                  <p className="text-[0.6rem] uppercase tracking-[0.18em] text-black/35">Move session</p>
                  <h3 className="mt-1 text-xl font-medium">{formatBookingDate(selectedBooking.start_at)}</h3>
                  <p className="mt-1 text-sm text-black/55">{formatBookingTime(selectedBooking.start_at)}</p>
                  <div className="mt-5 space-y-2">
                    <button
                      type="button"
                      onClick={() => setModalStep('booking-move-time')}
                      className="flex w-full items-center justify-between border border-black/10 px-4 py-3 text-sm text-black hover:border-black/30"
                    >
                      Different time, same day <ChevronRight className="h-4 w-4 text-black/35" />
                    </button>
                    <button
                      type="button"
                      onClick={() => { setMoveDayTarget(null); setModalStep('booking-move-day'); }}
                      className="flex w-full items-center justify-between border border-black/10 px-4 py-3 text-sm text-black hover:border-black/30"
                    >
                      Another day this week <ChevronRight className="h-4 w-4 text-black/35" />
                    </button>
                  </div>
                  <button type="button" onClick={() => setModalStep('booking-options')} className="mt-4 w-full border border-black/10 py-3 text-sm text-black/50 hover:text-black">
                    Back
                  </button>
                </div>
              )}

              {/* Move: different time, same day */}
              {modalStep === 'booking-move-time' && selectedBooking && (
                <div className="p-6">
                  <p className="text-[0.6rem] uppercase tracking-[0.18em] text-black/35">Different time, same day</p>
                  <h3 className="mt-1 text-xl font-medium">{formatBookingDate(selectedBooking.start_at)}</h3>
                  <div className="mt-4 max-h-48 overflow-y-auto">
                    {(() => {
                      const dayKey = calendarDateKey(selectedBooking.start_at);
                      const slots = (slotsByDate.get(dayKey) ?? []).filter(
                        (s) => s.available && s.start_at !== selectedBooking.start_at,
                      );
                      if (slots.length === 0) return <p className="text-sm text-black/40">No other available times on this day.</p>;
                      return (
                        <div className="space-y-1">
                          {slots.map((slot) => (
                            <button
                              key={slot.start_at}
                              type="button"
                              onClick={() => void moveSession(slot, selectedBooking.id)}
                              disabled={bookingBusy}
                              className="flex w-full items-center border border-black/10 px-4 py-2.5 text-sm hover:border-black/30 hover:bg-[#fbfbf8] disabled:opacity-40"
                            >
                              {formatBookingTime(slot.start_at)} - {formatBookingTime(slot.end_at)}
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                  <button type="button" onClick={() => setModalStep('booking-move')} className="mt-4 w-full border border-black/10 py-3 text-sm text-black/50 hover:text-black">
                    Back
                  </button>
                </div>
              )}

              {/* Move: another day this week */}
              {modalStep === 'booking-move-day' && selectedBooking && (
                <div className="p-6">
                  <p className="text-[0.6rem] uppercase tracking-[0.18em] text-black/35">
                    {moveDayTarget ? 'Pick a time' : 'Pick a day'}
                  </p>
                  {!moveDayTarget ? (
                    <>
                      <div className="mt-4 space-y-1">
                        {getMovableDays(selectedBooking).map((day) => {
                          const key = calendarDateKey(day);
                          const hasSlots = (slotsByDate.get(key) ?? []).some((s) => s.available);
                          return (
                            <button
                              key={key}
                              type="button"
                              disabled={!hasSlots}
                              onClick={() => setMoveDayTarget(key)}
                              className="flex w-full items-center justify-between border border-black/10 px-4 py-3 text-sm hover:border-black/30 hover:bg-[#fbfbf8] disabled:opacity-30"
                            >
                              <span>{formatBookingDate(day)}</span>
                              {hasSlots ? <ChevronRight className="h-4 w-4 text-black/35" /> : <span className="text-xs text-black/35">No slots</span>}
                            </button>
                          );
                        })}
                      </div>
                      <button type="button" onClick={() => setModalStep('booking-move')} className="mt-4 w-full border border-black/10 py-3 text-sm text-black/50 hover:text-black">
                        Back
                      </button>
                    </>
                  ) : (
                    <>
                      <h3 className="mt-1 text-xl font-medium">{formatBookingDate(moveDayTarget)}</h3>
                      <div className="mt-4 max-h-48 overflow-y-auto space-y-1">
                        {(slotsByDate.get(moveDayTarget) ?? []).filter((s) => s.available).map((slot) => (
                          <button
                            key={slot.start_at}
                            type="button"
                            onClick={() => void moveSession(slot, selectedBooking.id)}
                            disabled={bookingBusy}
                            className="flex w-full items-center border border-black/10 px-4 py-2.5 text-sm hover:border-black/30 hover:bg-[#fbfbf8] disabled:opacity-40"
                          >
                            {formatBookingTime(slot.start_at)} - {formatBookingTime(slot.end_at)}
                          </button>
                        ))}
                      </div>
                      <button type="button" onClick={() => setMoveDayTarget(null)} className="mt-4 w-full border border-black/10 py-3 text-sm text-black/50 hover:text-black">
                        Back to days
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Cancel session */}
              {modalStep === 'booking-cancel' && selectedBooking && (
                <div className="p-6">
                  {bookingWithin24Hours(selectedBooking) ? (
                    <>
                      <p className="text-[0.6rem] uppercase tracking-[0.18em] text-amber-600">24-hour window</p>
                      <h3 className="mt-1 text-lg font-medium leading-snug">Your session is within the 24-hour window.</h3>
                      <p className="mt-2 text-sm text-black/55">Emergencies happen. What is your reason for cancelling? Pedro will review your request and approve or decline.</p>
                      <textarea
                        value={bookingReason}
                        onChange={(e) => setBookingReason(e.target.value)}
                        rows={3}
                        className="mt-3 w-full resize-none border border-black/10 bg-white px-3 py-3 text-sm outline-none focus:border-black/35"
                        placeholder="Type your reason here..."
                      />
                      <div className="mt-3 space-y-2">
                        <button
                          type="button"
                          onClick={() => void cancelBooking(selectedBooking)}
                          disabled={bookingBusy || !bookingReason.trim()}
                          className="w-full bg-black py-3 text-sm font-medium text-white hover:bg-black/85 disabled:opacity-40"
                        >
                          {bookingBusy ? 'Submitting...' : 'Submit cancellation request'}
                        </button>
                        <button type="button" onClick={() => setModalStep('booking-options')} className="w-full border border-black/10 py-3 text-sm text-black/50 hover:text-black">
                          Keep my session
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-[0.6rem] uppercase tracking-[0.18em] text-black/35">Cancel session</p>
                      <h3 className="mt-1 text-xl font-medium">{formatBookingDate(selectedBooking.start_at)}</h3>
                      <p className="mt-1 text-sm text-black/55">{formatBookingTime(selectedBooking.start_at)}</p>
                      <p className="mt-4 text-sm text-black/55">Are you sure you want to cancel this session?</p>
                      <div className="mt-5 space-y-2">
                        <button
                          type="button"
                          onClick={() => void cancelBooking(selectedBooking)}
                          disabled={bookingBusy}
                          className="w-full border border-red-300 bg-red-50 py-3 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-40"
                        >
                          {bookingBusy ? 'Cancelling...' : 'Yes, cancel session'}
                        </button>
                        <button type="button" onClick={() => setModalStep('booking-options')} className="w-full border border-black/10 py-3 text-sm text-black/50 hover:text-black">
                          Keep my session
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    );
  };

  const renderNutritionScreen = () => (
    <NutritionTab clientId={client!.id} />
  );

  const renderSettingsScreen = () => (
    <SettingsTab clientId={client!.id} userEmail={client?.email ?? ''} />
  );

  const renderActiveScreen = () => {
    if (selectedWorkout?.started) return renderWorkoutLogger();
    if (selectedWorkout) return renderWorkoutPreview();
    if (activeScreen === 'workout') return renderWorkoutHome();
    if (activeScreen === 'nutrition') return renderNutritionScreen();
    if (activeScreen === 'booking') return renderBookingScreen();
    if (activeScreen === 'settings') return renderSettingsScreen();
    return renderOverviewScreen();
  };

  return (
    <main className="client-liquid flex h-dvh min-h-0 flex-col overflow-hidden text-black">
      {renderHeader()}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 pb-36 md:p-10 md:pb-28">
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
        <nav className="client-bottom-nav fixed inset-x-2 bottom-4 z-40 border border-black/10 bg-white/95 px-1.5 py-1.5 shadow-[0_-10px_30px_rgba(0,0,0,0.06)] backdrop-blur md:inset-x-auto md:left-1/2 md:w-[32rem] md:-translate-x-1/2">
          <div className="mx-auto grid max-w-sm grid-cols-5 gap-0.5">
            {([
              ['overview', Home, 'Overview'],
              ['nutrition', Salad, 'Nutrition'],
              ['workout', Dumbbell, 'Workout'],
              ['booking', Wrench, 'Booking'],
              ['settings', Settings, 'Settings'],
            ] as const).map(([screen, Icon, label]) => (
              <button
                key={screen}
                type="button"
                onClick={() => {
                  setSelectedWorkout(null);
                  setActiveScreen(screen);
                }}
                className={`flex h-11 flex-col items-center justify-center gap-0.5 border text-[0.58rem] uppercase tracking-[0.06em] transition-colors ${
                  activeScreen === screen
                    ? 'border-black bg-black text-white'
                    : 'border-transparent text-black/40 hover:border-black/10 hover:text-black'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </nav>
      )}

      {client && !isPedro && (
        <div className="fixed right-[4.75rem] top-4 z-50 flex h-12 flex-col items-center justify-center md:right-[5.5rem] md:top-6">
          <span className="text-xl font-light leading-none tabular-nums">{client.sessions_remaining ?? 0}</span>
          <span className="mt-0.5 text-[0.5rem] uppercase tracking-[0.14em] text-black/40">sessions</span>
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

      {showCheckinModal && client && (
        <WeeklyCheckinModal
          clientId={client.id}
          clientName={client.name}
          onClose={() => setShowCheckinModal(false)}
          onComplete={(focus) => {
            setCheckinFocus(focus);
            setShowCheckinModal(false);
            void loadPortal();
          }}
        />
      )}
    </main>
  );
}
