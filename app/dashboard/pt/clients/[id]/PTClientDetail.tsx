'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import {
  computeAdherenceSnapshot,
  getGoalProgressLabel,
  latestMetricPair,
  latestReviewByType,
  monthEndInputValue,
  monthStartInputValue,
} from '@/utils/pt/coaching';
import type {
  PT1RMTest,
  PTCheckinSession,
  PTClient,
  PTClientGoal,
  PTClientMetric,
  PTClientNutritionDoc,
  PTPhaseNutrition,
  PTCoachingReview,
  PTCoachingTask,
  PTProgramAssignment,
  PTProgramTemplate,
  PTWeeklyPlan,
  PTWeeklyPlanConfirmationStatus,
  PTWeeklyPlanItem,
  PTWeeklyPlanItemStatus,
  PTWeeklyPlanItemType,
  PTWeeklyPlanSlotStatus,
  PTWeeklyCheckin,
} from '@/utils/pt/types';
import WeeklyClientProgress, {
  type WeeklyNutritionLog,
  type WeeklySetLog,
  type WeeklyWorkoutLog,
} from './WeeklyClientProgress';

const STATUS_OPTIONS: PTClient['status'][] = ['invited', 'active', 'paused', 'archived'];
const STATUS_COLORS: Record<PTClient['status'], string> = {
  invited: 'bg-amber-50 text-amber-700 border-amber-200',
  active: 'bg-green-50 text-green-700 border-green-200',
  paused: 'bg-black/5 text-black/50 border-black/10',
  archived: 'bg-black/5 text-black/30 border-black/8',
};

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

const PLAN_ITEM_TYPES = Object.keys(PLAN_ITEM_LABELS) as PTWeeklyPlanItemType[];

const SLOT_STATUS_LABELS: Record<PTWeeklyPlanSlotStatus, string> = {
  unconfirmed: 'Unconfirmed',
  confirmed: 'Confirmed',
  moved: 'Moved',
  cancelled: 'Cancelled',
};

const CONFIRMATION_LABELS: Record<PTWeeklyPlanConfirmationStatus, string> = {
  none: 'No confirmation',
  needs_confirmation: 'Needs confirmation',
  confirmed: 'Confirmed',
  moved: 'Moved',
  cancelled: 'Cancelled',
};

const ITEM_STATUS_LABELS: Record<PTWeeklyPlanItemStatus, string> = {
  planned: 'Planned',
  done: 'Done',
  skipped: 'Skipped',
  moved: 'Moved',
};

const GOAL_TYPE_OPTIONS = [
  { value: 'general', label: 'General' },
  { value: 'weight', label: 'Weight' },
  { value: 'waist', label: 'Waist' },
  { value: 'body_fat', label: 'Body fat' },
  { value: 'muscle_mass', label: 'Muscle' },
  { value: 'strength', label: 'Strength' },
  { value: 'running', label: 'Running' },
  { value: 'mobility', label: 'Mobility' },
  { value: 'event', label: 'Event' },
] as const;

interface PTEvent {
  id: string;
  event_type: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

interface PTNote {
  id: string;
  content: string;
  is_active: boolean;
  created_at: string;
  source_message_id: string | null;
  context?: Record<string, unknown>;
}

const ONE_RM_EXERCISES = ['BB Squat', 'BB Deadlift', 'BB Bench Press', 'BB Shoulder Press', 'Pull-up'] as const;
type OneRMExercise = typeof ONE_RM_EXERCISES[number];

function phaseLooksLikeTesting(title: string): boolean {
  return /1\s*rm|test/i.test(title);
}

function findPostOneRmPhaseIndex(assignment: PTProgramAssignment | undefined): number | null {
  if (!assignment) return null;
  const phases = assignment.programme.phases;
  const currentIndex = typeof assignment.current_phase_index === 'number'
    ? assignment.current_phase_index
    : phases.findIndex((phase) => phaseLooksLikeTesting(phase.title));
  if (currentIndex < 0) return null;

  const nextTrainingPhaseIndex = phases.findIndex((phase, phaseIndex) =>
    phaseIndex > currentIndex && !phaseLooksLikeTesting(phase.title),
  );
  return nextTrainingPhaseIndex >= 0 ? nextTrainingPhaseIndex : null;
}

function epley1RM(weightKg: number, reps: number): number {
  if (reps === 1) return weightKg;
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}

function warmUpSets(goalKg: number) {
  return [
    { label: 'Empty bar', weight: 20, reps: 6, note: 'Movement prep' },
    { label: '50%', weight: Math.round(goalKg * 0.5 * 2) / 2, reps: 5, note: '' },
    { label: '65%', weight: Math.round(goalKg * 0.65 * 2) / 2, reps: 3, note: '' },
    { label: '75%', weight: Math.round(goalKg * 0.75 * 2) / 2, reps: 2, note: '' },
    { label: '85%', weight: Math.round(goalKg * 0.85 * 2) / 2, reps: 1, note: '' },
  ];
}

interface Props {
  client: PTClient;
  templates: PTProgramTemplate[];
  assignments: PTProgramAssignment[];
  events: PTEvent[];
  notes: PTNote[];
  weeklyCheckins: PTWeeklyCheckin[];
  weeklyPlans: PTWeeklyPlan[];
  weeklyPlanItems: PTWeeklyPlanItem[];
  metrics: PTClientMetric[];
  goals: PTClientGoal[];
  coachingTasks: PTCoachingTask[];
  reviews: PTCoachingReview[];
  checkinSessions?: PTCheckinSession[];
  oneRmTests?: PT1RMTest[];
  nutritionDoc?: PTClientNutritionDoc | null;
  phaseNutrition?: PTPhaseNutrition[];
  nutritionLogs?: WeeklyNutritionLog[];
  workoutLogs?: WeeklyWorkoutLog[];
  weeklySetLogs?: WeeklySetLog[];
  priorSetLogs?: WeeklySetLog[];
  brainReports?: Array<{
    id: string;
    week_start: string;
    coach_summary: string | null;
    nutrition_summary: string | null;
    training_summary: string | null;
    flags: unknown;
  }>;
}

interface SpeechRecognitionResultItemLike { transcript: string; }
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionResultItemLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface ProgrammingAgentResponse {
  ok?: boolean;
  error?: string;
  mode?: 'new_programme' | 'revise_programme';
  run_id?: string;
  review_status?: string;
  validation_summary?: Record<string, unknown>;
  client_id?: string;
  assignment_id?: string | null;
  name?: string;
  goal?: string;
  change_summary?: string;
  programme?: unknown;
}

interface PlanItemDraft {
  local_id: string;
  item_type: PTWeeklyPlanItemType;
  scheduled_date: string;
  title: string;
  details: string;
  status: PTWeeklyPlanItemStatus;
  confirmation_status: PTWeeklyPlanConfirmationStatus;
  linked_assignment_id: string;
  linked_phase_index: string;
  linked_day_index: string;
}

interface WeeklyPlanDraft {
  coach_summary: string;
  client_note: string;
  regular_slot: string;
  regular_slot_status: PTWeeklyPlanSlotStatus;
  items: PlanItemDraft[];
}

interface WeeklyPlanAgentResponse {
  error?: string;
  coach_summary?: string;
  client_note?: string;
  regular_slot?: string | null;
  regular_slot_status?: PTWeeklyPlanSlotStatus;
  items?: Array<{
    item_type?: PTWeeklyPlanItemType;
    scheduled_date?: string | null;
    title?: string;
    details?: string | null;
    confirmation_status?: PTWeeklyPlanConfirmationStatus;
    linked_assignment_id?: string | null;
    linked_phase_index?: number | null;
    linked_day_index?: number | null;
  }>;
}

interface ReviewAgentResponse {
  error?: string;
  review_type: 'weekly' | 'monthly';
  period_start: string;
  period_end: string;
  total_items: number;
  completed_items: number;
  skipped_items: number;
  adherence_pct: number | null;
  metrics_summary: string;
  performance_summary: string;
  client_feedback: string;
  what_got_done: string;
  what_was_missed: string;
  suggested_changes: string;
  pedro_summary: string;
  client_summary: string;
  body_snapshot: Record<string, unknown>;
  performance_snapshot: Record<string, unknown>;
}

function getSR() {
  const w = window as Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

function metricValue(value: number | null, unit: string) {
  return value === null || value === undefined ? '-' : `${Number(value).toLocaleString('en-AU')} ${unit}`;
}

function scoreLabel(value: number | null) {
  return value === null || value === undefined ? '-' : `${value}/5`;
}

function weekStartInputValue(date = new Date()) {
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  return dateInputValue(next);
}

function addDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return dateInputValue(next);
}

function dateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatWeekRange(weekStart: string) {
  return `${formatDate(weekStart)} - ${formatDate(addDays(weekStart, 6))}`;
}

function planItemId() {
  return `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function dateForSlot(weekStart: string, slot: string | null | undefined) {
  const normalised = slot?.toLowerCase() ?? '';
  const days = [
    ['monday', 0],
    ['tuesday', 1],
    ['wednesday', 2],
    ['thursday', 3],
    ['friday', 4],
    ['saturday', 5],
    ['sunday', 6],
  ] as const;
  const match = days.find(([day]) => normalised.includes(day));
  return match ? addDays(weekStart, match[1]) : weekStart;
}

function emptyPlanDraft(client: PTClient, weekStart: string): WeeklyPlanDraft {
  return {
    coach_summary: '',
    client_note: '',
    regular_slot: client.regular_training_slot ?? '',
    regular_slot_status: client.regular_training_slot ? 'confirmed' : 'unconfirmed',
    items: client.regular_training_slot
      ? [{
          local_id: planItemId(),
          item_type: 'pt_session',
          scheduled_date: dateForSlot(weekStart, client.regular_training_slot),
          title: 'In-person PT session',
          details: client.regular_training_slot,
          status: 'planned',
          confirmation_status: 'confirmed',
          linked_assignment_id: '',
          linked_phase_index: '',
          linked_day_index: '',
        }]
      : [],
  };
}

function draftFromPlan(plan: PTWeeklyPlan | null, items: PTWeeklyPlanItem[], client: PTClient, weekStart: string): WeeklyPlanDraft {
  if (!plan) return emptyPlanDraft(client, weekStart);
  return {
    coach_summary: plan.coach_summary ?? '',
    client_note: plan.client_note ?? '',
    regular_slot: plan.regular_slot ?? '',
    regular_slot_status: plan.regular_slot_status,
    items: items.map((item) => ({
      local_id: item.id,
      item_type: item.item_type,
      scheduled_date: item.scheduled_date ?? '',
      title: item.title,
      details: item.details ?? '',
      status: item.status,
      confirmation_status: item.confirmation_status,
      linked_assignment_id: item.linked_assignment_id ?? '',
      linked_phase_index: item.linked_phase_index === null ? '' : String(item.linked_phase_index),
      linked_day_index: item.linked_day_index === null ? '' : String(item.linked_day_index),
    })),
  };
}

export default function PTClientDetail({
  client: initial,
  templates,
  assignments,
  events,
  notes: initialNotes,
  weeklyCheckins: initialWeeklyCheckins,
  weeklyPlans: initialWeeklyPlans,
  weeklyPlanItems: initialWeeklyPlanItems,
  metrics: initialMetrics,
  goals: initialGoals,
  coachingTasks: initialCoachingTasks,
  reviews: initialReviews,
  checkinSessions = [],
  oneRmTests: initialOneRmTests = [],
  nutritionDoc = null,
  phaseNutrition = [],
  nutritionLogs = [],
  workoutLogs = [],
  weeklySetLogs = [],
  priorSetLogs = [],
  brainReports = [],
}: Props) {
  const supabase = createClient();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const agentSpeechRef = useRef<SpeechRecognitionLike | null>(null);

  const [client, setClient] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: initial.name,
    goals: initial.goals ?? '',
    notes: initial.notes ?? '',
    sessions_remaining: initial.sessions_remaining,
    lifestyle_context: initial.lifestyle_context ?? '',
    regular_training_slot: initial.regular_training_slot ?? '',
    coaching_focus: initial.coaching_focus ?? '',
    event_goal: initial.event_goal ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignmentList, setAssignmentList] = useState(assignments);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  useEffect(() => { setAssignmentList(assignments); }, [assignments]);
  const [inviting, setInviting] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordPanelOpen, setPasswordPanelOpen] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [notes, setNotes] = useState(initialNotes);
  const [weeklyCheckins, setWeeklyCheckins] = useState(initialWeeklyCheckins);
  const [weeklyPlans, setWeeklyPlans] = useState(initialWeeklyPlans);
  const [weeklyPlanItems, setWeeklyPlanItems] = useState(initialWeeklyPlanItems);
  const [selectedWeekStart, setSelectedWeekStart] = useState(weekStartInputValue());
  const [planDraft, setPlanDraft] = useState<WeeklyPlanDraft>(() => emptyPlanDraft(initial, weekStartInputValue()));
  const [savingPlan, setSavingPlan] = useState(false);
  const [draftingPlan, setDraftingPlan] = useState(false);
  const [metrics, setMetrics] = useState(initialMetrics);
  const [goals, setGoals] = useState(initialGoals);
  const [coachingTasks, setCoachingTasks] = useState(initialCoachingTasks);
  const [reviews, setReviews] = useState(initialReviews);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [status, setStatus] = useState('');
  const [reviewBusy, setReviewBusy] = useState<'weekly' | 'monthly' | null>(null);
  const [agentInstructions, setAgentInstructions] = useState('');
  const [agentBusy, setAgentBusy] = useState<'new_programme' | 'revise_programme' | null>(null);
  const [agentListening, setAgentListening] = useState(false);
  const [agentStatus, setAgentStatus] = useState('');
  const [oneRmTests, setOneRmTests] = useState<PT1RMTest[]>(initialOneRmTests);
  const [oneRmModalOpen, setOneRmModalOpen] = useState(false);
  const [oneRmSaving, setOneRmSaving] = useState(false);
  const [oneRmStatus, setOneRmStatus] = useState('');
  const [oneRmAdvancePhaseIndex, setOneRmAdvancePhaseIndex] = useState<number | null>(null);
  const [oneRmAdvanceBusy, setOneRmAdvanceBusy] = useState(false);
  const [oneRmInputs, setOneRmInputs] = useState<Record<OneRMExercise, { weight: string; reps: string }>>(
    () => Object.fromEntries(ONE_RM_EXERCISES.map((ex) => [ex, { weight: '', reps: '1' }])) as Record<OneRMExercise, { weight: string; reps: string }>,
  );
  const [recalcBusy, setRecalcBusy] = useState(false);
  const [newGoal, setNewGoal] = useState({
    goal_type: 'general',
    title: '',
    target_value: '',
    current_value: '',
    unit: '',
    target_date: '',
    notes: '',
  });

  const save = async () => {
    setSaving(true);
    const { data, error } = await supabase
      .from('pt_clients')
      .update({
        name: form.name.trim(),
        goals: form.goals.trim() || null,
        notes: form.notes.trim() || null,
        sessions_remaining: form.sessions_remaining,
        lifestyle_context: form.lifestyle_context.trim() || null,
        regular_training_slot: form.regular_training_slot.trim() || null,
        coaching_focus: form.coaching_focus.trim() || null,
        event_goal: form.event_goal.trim() || null,
      })
      .eq('id', client.id)
      .select()
      .single();
    if (!error && data) setClient(data as PTClient);
    setEditing(false);
    setSaving(false);
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setStatus('Uploading…');
    const path = `${client.id}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage
      .from('pt-client-docs')
      .upload(path, file, { upsert: true });
    if (upErr) {
      setStatus(`Upload failed: ${upErr.message}`);
      setUploading(false);
      return;
    }
    const { data: updated } = await supabase
      .from('pt_clients')
      .update({ document_url: path })
      .eq('id', client.id)
      .select()
      .single();
    if (updated) setClient(updated as PTClient);
    setStatus('Document saved.');
    setUploading(false);
  };

  const viewDocument = async () => {
    if (!client.document_url) return;
    const { data } = await supabase.storage
      .from('pt-client-docs')
      .createSignedUrl(client.document_url, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  };

  const assignProgramme = async (templateId: string) => {
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    setAssigningId(templateId);
    await supabase.from('pt_program_assignments').insert({
      client_id: client.id,
      template_id: templateId,
      name: template.name,
      goal: template.goal,
      duration_weeks: template.duration_weeks,
      phase_count: template.phase_count,
      status: 'draft',
      programme: template.programme,
      generation_run_id: template.generation_run_id ?? null,
      coach_review_status: 'approved',
      validation_summary: template.validation_summary ?? {},
      current_phase_index: 0,
      current_block_index: 0,
      current_week: 1,
    });
    await supabase.from('pt_events').insert({
      client_id: client.id,
      event_type: 'programme_assigned',
      metadata: { template_id: templateId, template_name: template.name },
    });
    setAssigningId(null);
    router.refresh();
  };

  const saveOneRmResults = async () => {
    const filled = ONE_RM_EXERCISES.filter((ex) => oneRmInputs[ex].weight !== '');
    if (filled.length === 0) { setOneRmStatus('Enter at least one result.'); return; }
    setOneRmSaving(true);
    setOneRmStatus('Saving...');

    const { data: testRow, error: testErr } = await supabase
      .from('pt_client_1rm_tests')
      .insert({
        client_id: client.id,
        assignment_id: activeAssignment?.id ?? null,
        tested_at: new Date().toISOString().slice(0, 10),
        notes: null,
      })
      .select('id')
      .single();

    if (testErr || !testRow) {
      setOneRmStatus(`Error: ${testErr?.message ?? 'Could not create test session.'}`);
      setOneRmSaving(false);
      return;
    }

    const resultRows = filled.map((ex) => {
      const w = parseFloat(oneRmInputs[ex].weight);
      const r = parseInt(oneRmInputs[ex].reps, 10) || 1;
      const estimated = epley1RM(w, r);
      return {
        test_id: testRow.id,
        client_id: client.id,
        exercise_name: ex,
        tested_weight_kg: w,
        tested_reps: r,
        estimated_1rm_kg: estimated,
        notes: null,
      };
    });

    const { error: resultErr } = await supabase.from('pt_client_1rm_results').insert(resultRows.map((row) => ({
      test_id: row.test_id,
      client_id: row.client_id,
      exercise_name: row.exercise_name,
      load_kg: row.tested_weight_kg,
      reps: row.tested_reps,
      estimated_1rm_kg: row.estimated_1rm_kg,
      notes: row.notes,
    })));
    if (resultErr) {
      setOneRmStatus(`Error saving results: ${resultErr.message}`);
      setOneRmSaving(false);
      return;
    }

    await supabase.functions.invoke('update-client-brain', {
      body: {
        client_id: client.id,
        trigger_type: '1rm_result',
        content: `1RM test recorded for ${filled.join(', ')}.`,
        structured_data: {
          '1rm_result': {
            test_id: testRow.id,
            tested_at: new Date().toISOString().slice(0, 10),
            results: resultRows.map((r) => ({
              exercise: r.exercise_name,
              tested_weight_kg: r.tested_weight_kg,
              tested_reps: r.tested_reps,
              estimated_1rm_kg: r.estimated_1rm_kg,
            })),
          },
        },
      },
    }).catch(() => {});

    if (activeAssignment?.generation_run_id) {
      void supabase.from('pt_program_generation_steps').insert({
        run_id: activeAssignment.generation_run_id,
        step_order: 19,
        command_name: 'STORE_1RM_RESULTS',
        status: 'succeeded',
        input_json: {
          test_id: testRow.id,
          exercises: resultRows.map((r) => ({
            exercise: r.exercise_name,
            tested_weight_kg: r.tested_weight_kg,
            tested_reps: r.tested_reps,
            estimated_1rm_kg: r.estimated_1rm_kg,
          })),
        },
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
    }

    const newTest: PT1RMTest = { id: testRow.id, client_id: client.id, assignment_id: activeAssignment?.id ?? null, tested_at: new Date().toISOString().slice(0, 10), notes: null, created_at: new Date().toISOString(), results: resultRows.map((r, i) => ({ id: `temp-${i}`, test_id: testRow.id, client_id: client.id, exercise_name: r.exercise_name, tested_weight_kg: r.tested_weight_kg, tested_reps: r.tested_reps, estimated_1rm_kg: r.estimated_1rm_kg, notes: null, created_at: new Date().toISOString() })) };
    setOneRmTests((prev) => [newTest, ...prev]);
    setOneRmAdvancePhaseIndex(findPostOneRmPhaseIndex(activeAssignment));
    setOneRmStatus('Saved.');
    setOneRmInputs(Object.fromEntries(ONE_RM_EXERCISES.map((ex) => [ex, { weight: '', reps: '1' }])) as Record<OneRMExercise, { weight: string; reps: string }>);
    setOneRmSaving(false);
  };

  const advanceAfterOneRm = async () => {
    if (!activeAssignment || oneRmAdvancePhaseIndex === null) return;
    const nextPhase = activeAssignment.programme.phases[oneRmAdvancePhaseIndex];
    setOneRmAdvanceBusy(true);
    setOneRmStatus(`Moving to ${nextPhase?.title ?? 'next phase'}...`);

    const { error } = await supabase
      .from('pt_program_assignments')
      .update({
        current_phase_index: oneRmAdvancePhaseIndex,
        current_block_index: 0,
        current_week: 1,
      })
      .eq('id', activeAssignment.id);

    if (error) {
      setOneRmStatus(`Could not move phase: ${error.message}`);
      setOneRmAdvanceBusy(false);
      return;
    }

    await supabase.from('pt_events').insert({
      client_id: client.id,
      assignment_id: activeAssignment.id,
      event_type: 'programme_position_changed',
      metadata: {
        source: '1rm_results',
        assignment_name: activeAssignment.name,
        from: {
          phase_index: activeAssignment.current_phase_index,
          block_index: activeAssignment.current_block_index,
          week: activeAssignment.current_week,
        },
        to: {
          phase_index: oneRmAdvancePhaseIndex,
          phase_title: nextPhase?.title ?? null,
          block_index: 0,
          week: 1,
          weeks_left: nextPhase?.weeks ?? null,
        },
      },
    });

    setAssignmentList((prev) => prev.map((assignment) =>
      assignment.id === activeAssignment.id
        ? { ...assignment, current_phase_index: oneRmAdvancePhaseIndex, current_block_index: 0, current_week: 1 }
        : assignment,
    ));
    setOneRmAdvancePhaseIndex(null);
    setOneRmAdvanceBusy(false);
    setOneRmStatus(`Moved to ${nextPhase?.title ?? 'next phase'}.`);
  };

  const recalculateLoads = async () => {
    if (!activeAssignment) return;
    setRecalcBusy(true);
    setOneRmStatus('Recalculating percentage loads...');
    const { error } = await supabase.functions.invoke('recalculate-percentage-loads', {
      body: { client_id: client.id, assignment_id: activeAssignment.id },
    });
    if (!error && activeAssignment.generation_run_id) {
      void supabase.from('pt_program_generation_steps').insert({
        run_id: activeAssignment.generation_run_id,
        step_order: 20,
        command_name: 'RECALCULATE_PERCENTAGE_LOADS',
        status: 'succeeded',
        input_json: { client_id: client.id, assignment_id: activeAssignment.id },
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
    }
    setRecalcBusy(false);
    setOneRmStatus(error ? `Error: ${error.message}` : 'Loads recalculated. Refresh the programme editor to see kg targets.');
  };

  const sendInvite = async () => {
    setInviting(true);
    setStatus(client.password_created_at ? 'Sending login link...' : 'Sending setup link...');
    const { data, error } = await supabase.functions.invoke<{ action?: 'login_link_sent' | 'setup_link_sent' }>('invite-pt-client', {
      body: { client_id: client.id },
    });
    if (error) {
      setStatus(`Error: ${error.message}`);
    } else {
      setStatus(data?.action === 'login_link_sent' ? 'Login link sent.' : 'Setup link sent.');
    }
    setInviting(false);
  };

  const handlePasswordAction = async (action: 'send_reset' | 'set_temporary_password') => {
    setPasswordBusy(true);
    setTemporaryPassword('');
    setStatus(action === 'send_reset' ? 'Sending password reset link...' : 'Creating temporary password...');
    const { data, error } = await supabase.functions.invoke<{
      action?: 'password_reset_sent' | 'temporary_password_set';
      password?: string;
    }>('manage-pt-client-password', {
      body: { client_id: client.id, action },
    });

    if (error) {
      setStatus(`Error: ${error.message}`);
    } else if (data?.action === 'temporary_password_set' && data.password) {
      setTemporaryPassword(data.password);
      setStatus('Temporary password created.');
      setClient((current) => ({
        ...current,
        status: 'active',
        password_created_at: current.password_created_at ?? new Date().toISOString(),
      }));
    } else {
      setStatus('Password reset link sent.');
    }
    setPasswordBusy(false);
  };

  const deleteClient = async () => {
    const { error } = await supabase.functions.invoke('delete-pt-client', {
      body: { client_id: client.id },
    });
    if (!error) {
      router.push('/dashboard/pt/clients');
    } else {
      setStatus(`Error: ${error.message}`);
      setConfirmDelete(false);
    }
  };

  const activeAssignment = assignmentList.find((a) => a.status === 'active');

  // One programme is active per client. Toggling one on activates it and pauses the rest;
  // toggling the active one off leaves the client with no active programme.
  const setActiveProgramme = async (assignmentId: string) => {
    if (togglingId) return;
    const target = assignmentList.find((a) => a.id === assignmentId);
    if (!target) return;
    const turningOff = target.status === 'active';
    setTogglingId(assignmentId);
    setAssignmentList((cur) => cur.map((a) => (
      turningOff
        ? (a.id === assignmentId ? { ...a, status: 'paused' } : a)
        : { ...a, status: a.id === assignmentId ? 'active' : 'paused' }
    )));
    let failed = false;
    if (turningOff) {
      const { error } = await supabase.from('pt_program_assignments').update({ status: 'paused' }).eq('id', assignmentId);
      failed = Boolean(error);
    } else {
      await supabase.from('pt_program_assignments').update({ status: 'paused' }).eq('client_id', client.id).neq('id', assignmentId);
      const { error } = await supabase.from('pt_program_assignments').update({ status: 'active' }).eq('id', assignmentId);
      failed = Boolean(error);
    }
    setTogglingId(null);
    router.refresh();
    if (failed) setAssignmentList(assignments);
  };
  const lastLogin = events.find((e) => e.event_type === 'client_login');
  const workoutActivity = events.find((e) => e.event_type === 'workout_logged');
  const accountIsLive = client.status === 'active' || Boolean(client.password_created_at || lastLogin || workoutActivity);
  const accountDetail = lastLogin
    ? `Logged in ${new Date(lastLogin.created_at).toLocaleDateString('en-AU')}`
    : workoutActivity
      ? `Workout logged ${new Date(workoutActivity.created_at).toLocaleDateString('en-AU')}`
      : client.password_created_at
        ? `Since ${new Date(client.password_created_at).toLocaleDateString('en-AU')}`
        : client.status === 'active'
          ? 'Client is active'
          : null;

  const latestCheckin = weeklyCheckins[0] ?? null;
  const latestMetric = metrics[0] ?? null;
  const activeGoals = goals.filter((goal) => goal.status === 'active');
  const selectedMonthStart = monthStartInputValue(selectedWeekStart);
  const selectedMonthEnd = monthEndInputValue(selectedWeekStart);
  const currentPlan = weeklyPlans.find((plan) => plan.week_start === selectedWeekStart) ?? null;
  const currentPlanItems = useMemo(
    () => weeklyPlanItems
      .filter((item) => item.plan_id === currentPlan?.id)
      .sort((a, b) => {
        const dateCompare = (a.scheduled_date ?? '').localeCompare(b.scheduled_date ?? '');
        if (dateCompare !== 0) return dateCompare;
        return a.sort_order - b.sort_order;
      }),
    [currentPlan?.id, weeklyPlanItems],
  );
  const checkinForSelectedWeek = weeklyCheckins.find((checkin) => checkin.week_start === selectedWeekStart) ?? latestCheckin;
  const weeklyAdherence = computeAdherenceSnapshot(weeklyPlanItems, weeklyPlans, selectedWeekStart, addDays(selectedWeekStart, 6));
  const monthlyAdherence = computeAdherenceSnapshot(weeklyPlanItems, weeklyPlans, selectedMonthStart, selectedMonthEnd);
  const selectedWeeklyReview = reviews.find((review) => review.review_type === 'weekly' && review.period_start === selectedWeekStart)
    ?? latestReviewByType(reviews, 'weekly');
  const selectedMonthlyReview = reviews.find((review) => review.review_type === 'monthly' && review.period_start === selectedMonthStart)
    ?? latestReviewByType(reviews, 'monthly');
  const latestBrainReport = brainReports[0] ?? null;
  const dailyTargets = nutritionDoc?.daily_targets ?? null;
  const currentPhaseNutrition = activeAssignment
    ? phaseNutrition.find((phase) => phase.assignment_id === activeAssignment.id)
    : phaseNutrition[0] ?? null;
  const weightPair = latestMetricPair(metrics, 'weight_kg');
  const waistPair = latestMetricPair(metrics, 'waist_cm');
  const bodyFatPair = latestMetricPair(metrics, 'body_fat_pct');
  const musclePair = latestMetricPair(metrics, 'muscle_mass_kg');
  const activeWorkoutOptions = activeAssignment
    ? activeAssignment.programme.phases.flatMap((phase, phaseIndex) =>
        phase.days.map((day, dayIndex) => ({
          value: `${phaseIndex}:${dayIndex}`,
          label: `${phase.title} / ${day.title}`,
        })),
      )
    : [];

  const planningSignals = [
    !currentPlan ? 'No plan exists for this week.' : null,
    currentPlan?.status === 'draft' ? 'Plan is still draft.' : null,
    !planDraft.items.some((item) => item.item_type === 'pt_session') ? 'No in-person PT session in this plan.' : null,
    !planDraft.regular_slot ? 'Regular slot is missing.' : null,
    planDraft.regular_slot_status !== 'confirmed' ? `Regular slot is ${SLOT_STATUS_LABELS[planDraft.regular_slot_status].toLowerCase()}.` : null,
    checkinForSelectedWeek?.status === 'submitted' ? 'Weekly reset is waiting for review.' : null,
    checkinForSelectedWeek?.travel ? `Travel/schedule note: ${checkinForSelectedWeek.travel}` : null,
    checkinForSelectedWeek?.injuries ? `Pain/injury note: ${checkinForSelectedWeek.injuries}` : null,
  ].filter((item): item is string => Boolean(item));

  useEffect(() => {
    setPlanDraft(draftFromPlan(currentPlan, currentPlanItems, client, selectedWeekStart));
  }, [client, currentPlan, currentPlanItems, selectedWeekStart]);

  const noteFixHref = (note: PTNote) => {
    const context = note.context ?? {};
    if (context.source !== 'workout_section' || typeof context.assignment_id !== 'string') return null;
    const params = new URLSearchParams();
    params.set('note', note.id);
    if (typeof context.phase_index === 'number') params.set('phase', String(context.phase_index));
    if (typeof context.day_index === 'number') params.set('day', String(context.day_index));
    if (typeof context.section_id === 'string') params.set('section', context.section_id);
    return `/dashboard/pt/programmes/${context.assignment_id}/edit?${params.toString()}`;
  };

  const noteContextLabel = (note: PTNote) => {
    const context = note.context ?? {};
    if (context.source !== 'workout_section') return null;
    const phase = typeof context.phase_index === 'number' ? `Phase ${context.phase_index + 1}` : null;
    const week = typeof context.week_number === 'number' ? `Week ${context.week_number}` : null;
    const workout = typeof context.workout_title === 'string' ? context.workout_title : null;
    const section = typeof context.section_title === 'string' ? context.section_title : null;
    return [phase, week, workout, section].filter(Boolean).join(' / ');
  };

  const markTaskDone = async (taskId: string) => {
    await supabase
      .from('pt_coaching_tasks')
      .update({ status: 'done', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', taskId);
    setCoachingTasks((current) => current.filter((task) => task.id !== taskId));
  };

  const markCheckinReviewed = async (checkinId: string) => {
    await supabase
      .from('pt_weekly_checkins')
      .update({ status: 'reviewed', updated_at: new Date().toISOString() })
      .eq('id', checkinId);
    setWeeklyCheckins((current) => current.map((item) => item.id === checkinId ? { ...item, status: 'reviewed' } : item));
  };

  const patchPlanItem = (localId: string, patch: Partial<PlanItemDraft>) => {
    setPlanDraft((current) => ({
      ...current,
      items: current.items.map((item) => (item.local_id === localId ? { ...item, ...patch } : item)),
    }));
  };

  const addPlanItem = (type: PTWeeklyPlanItemType = 'solo_strength') => {
    setPlanDraft((current) => ({
      ...current,
      items: [
        ...current.items,
        {
          local_id: planItemId(),
          item_type: type,
          scheduled_date: selectedWeekStart,
          title: PLAN_ITEM_LABELS[type],
          details: '',
          status: 'planned',
          confirmation_status: type === 'pt_session' ? 'needs_confirmation' : 'none',
          linked_assignment_id: '',
          linked_phase_index: '',
          linked_day_index: '',
        },
      ],
    }));
  };

  const removePlanItem = (localId: string) => {
    setPlanDraft((current) => ({
      ...current,
      items: current.items.filter((item) => item.local_id !== localId),
    }));
  };

  const buildFallbackPlan = () => {
    const items: PlanItemDraft[] = [];
    const add = (item: Omit<PlanItemDraft, 'local_id' | 'status'>) => {
      items.push({ ...item, local_id: planItemId(), status: 'planned' });
    };

    if (client.regular_training_slot) {
      add({
        item_type: 'pt_session',
        scheduled_date: dateForSlot(selectedWeekStart, client.regular_training_slot),
        title: 'In-person PT session',
        details: client.regular_training_slot,
        confirmation_status: checkinForSelectedWeek?.travel ? 'needs_confirmation' : 'confirmed',
        linked_assignment_id: '',
        linked_phase_index: '',
        linked_day_index: '',
      });
    }

    if (activeAssignment && activeAssignment.programme.phases[0]?.days[0]) {
      add({
        item_type: 'solo_strength',
        scheduled_date: addDays(selectedWeekStart, 2),
        title: activeAssignment.programme.phases[0].days[0].title || 'Solo strength',
        details: activeAssignment.programme.phases[0].days[0].focus || 'Complete the programmed solo session.',
        confirmation_status: 'none',
        linked_assignment_id: activeAssignment.id,
        linked_phase_index: '0',
        linked_day_index: '0',
      });
    }

    if (checkinForSelectedWeek?.run_days || client.event_goal) {
      add({
        item_type: 'run',
        scheduled_date: addDays(selectedWeekStart, 4),
        title: 'Easy run',
        details: checkinForSelectedWeek?.run_days || client.event_goal || '',
        confirmation_status: 'none',
        linked_assignment_id: '',
        linked_phase_index: '',
        linked_day_index: '',
      });
    }

    if (checkinForSelectedWeek?.golf_days || client.lifestyle_context?.toLowerCase().includes('golf')) {
      add({
        item_type: 'golf_mobility',
        scheduled_date: addDays(selectedWeekStart, 1),
        title: 'Golf mobility prep',
        details: checkinForSelectedWeek?.golf_days || 'Hip and thoracic rotation before golf.',
        confirmation_status: 'none',
        linked_assignment_id: '',
        linked_phase_index: '',
        linked_day_index: '',
      });
    }

    add({
      item_type: 'nutrition',
      scheduled_date: '',
      title: 'Nutrition focus',
      details: checkinForSelectedWeek?.nutrition_focus || client.coaching_focus || 'Keep the week simple and track the main nutrition target.',
      confirmation_status: 'none',
      linked_assignment_id: '',
      linked_phase_index: '',
      linked_day_index: '',
    });

    add({
      item_type: 'check_in',
      scheduled_date: addDays(selectedWeekStart, 6),
      title: 'Weekly check-in',
      details: 'Send Pedro notes on what got done, what moved, and what needs changing next week.',
      confirmation_status: 'none',
      linked_assignment_id: '',
      linked_phase_index: '',
      linked_day_index: '',
    });

    setPlanDraft({
      coach_summary: checkinForSelectedWeek?.client_focus || client.coaching_focus || 'Review and adjust the weekly plan.',
      client_note: 'Here is the shape of the week. Message Pedro if anything changes.',
      regular_slot: client.regular_training_slot ?? '',
      regular_slot_status: client.regular_training_slot && !checkinForSelectedWeek?.travel ? 'confirmed' : 'unconfirmed',
      items,
    });
  };

  const draftWeeklyPlan = async () => {
    setDraftingPlan(true);
    setStatus('Drafting weekly plan...');
    const { data, error } = await supabase.functions.invoke<WeeklyPlanAgentResponse>('draft-weekly-plan', {
      body: { client_id: client.id, week_start: selectedWeekStart },
    });

    if (error || data?.error || !data) {
      buildFallbackPlan();
      setStatus(`AI draft unavailable. A reset-based draft was created instead${error?.message || data?.error ? `: ${error?.message ?? data?.error}` : '.'}`);
      setDraftingPlan(false);
      return;
    }

    setPlanDraft({
      coach_summary: data.coach_summary ?? '',
      client_note: data.client_note ?? '',
      regular_slot: data.regular_slot ?? client.regular_training_slot ?? '',
      regular_slot_status: data.regular_slot_status ?? (client.regular_training_slot ? 'confirmed' : 'unconfirmed'),
      items: (data.items ?? []).map((item) => ({
        local_id: planItemId(),
        item_type: item.item_type ?? 'solo_strength',
        scheduled_date: item.scheduled_date ?? '',
        title: item.title ?? PLAN_ITEM_LABELS[item.item_type ?? 'solo_strength'],
        details: item.details ?? '',
        status: 'planned',
        confirmation_status: item.confirmation_status ?? 'none',
        linked_assignment_id: item.linked_assignment_id ?? '',
        linked_phase_index: item.linked_phase_index === null || item.linked_phase_index === undefined ? '' : String(item.linked_phase_index),
        linked_day_index: item.linked_day_index === null || item.linked_day_index === undefined ? '' : String(item.linked_day_index),
      })),
    });
    setStatus('AI draft ready. Review before publishing.');
    setDraftingPlan(false);
  };

  const saveWeeklyPlan = async (publish: boolean) => {
    setSavingPlan(true);
    setStatus(publish ? 'Publishing weekly plan...' : 'Saving weekly plan...');

    const now = new Date().toISOString();
    const { data: savedPlan, error: planError } = await supabase
      .from('pt_weekly_plans')
      .upsert({
        id: currentPlan?.id,
        client_id: client.id,
        week_start: selectedWeekStart,
        status: publish ? 'published' : 'draft',
        coach_summary: planDraft.coach_summary.trim() || null,
        client_note: planDraft.client_note.trim() || null,
        regular_slot: planDraft.regular_slot.trim() || null,
        regular_slot_status: planDraft.regular_slot_status,
        published_at: publish ? now : currentPlan?.published_at ?? null,
        updated_at: now,
      }, { onConflict: 'client_id,week_start' })
      .select('*')
      .single();

    if (planError || !savedPlan) {
      setStatus(planError?.message ?? 'Could not save weekly plan.');
      setSavingPlan(false);
      return;
    }

    const plan = savedPlan as PTWeeklyPlan;
    if (currentPlan?.id) {
      const { error: deleteError } = await supabase.from('pt_weekly_plan_items').delete().eq('plan_id', currentPlan.id);
      if (deleteError) {
        setStatus(deleteError.message);
        setSavingPlan(false);
        return;
      }
    }

    const rows = planDraft.items
      .filter((item) => item.title.trim())
      .map((item, index) => ({
        plan_id: plan.id,
        client_id: client.id,
        item_type: item.item_type,
        scheduled_date: item.scheduled_date || null,
        title: item.title.trim(),
        details: item.details.trim() || null,
        linked_assignment_id: item.linked_assignment_id || null,
        linked_phase_index: item.linked_phase_index === '' ? null : Number(item.linked_phase_index),
        linked_day_index: item.linked_day_index === '' ? null : Number(item.linked_day_index),
        status: item.status,
        confirmation_status: item.confirmation_status,
        sort_order: index,
        completed_at: item.status === 'done' ? now : null,
        updated_at: now,
      }));

    const { data: savedItems, error: itemError } = rows.length > 0
      ? await supabase.from('pt_weekly_plan_items').insert(rows).select('*')
      : { data: [], error: null };

    if (itemError) {
      setStatus(itemError.message);
      setSavingPlan(false);
      return;
    }

    setWeeklyPlans((current) => [plan, ...current.filter((item) => item.id !== plan.id && item.week_start !== plan.week_start)]);
    setWeeklyPlanItems((current) => [
      ...((savedItems ?? []) as PTWeeklyPlanItem[]),
      ...current.filter((item) => item.plan_id !== plan.id),
    ]);

    if (publish && checkinForSelectedWeek?.status === 'submitted') {
      await markCheckinReviewed(checkinForSelectedWeek.id);
    }

    setStatus(publish ? 'Weekly plan published to the client.' : 'Weekly plan saved as draft.');
    setSavingPlan(false);
  };

  const renderWeeklyPlanBuilder = () => (
    <div className="mt-4 border border-black/10 px-6 py-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[0.6rem] uppercase tracking-[0.16em] text-black/35">Weekly plan</p>
          <h3 className="mt-1 text-lg font-medium">{formatWeekRange(selectedWeekStart)}</h3>
          <p className="mt-1 text-xs text-black/40">
            {currentPlan ? `${currentPlan.status.charAt(0).toUpperCase()}${currentPlan.status.slice(1)}` : 'No plan yet'}
            {currentPlan?.published_at ? ` / Published ${new Date(currentPlan.published_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={selectedWeekStart}
            onChange={(event) => setSelectedWeekStart(event.target.value)}
            className="border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/35"
          />
          <button
            type="button"
            onClick={() => void draftWeeklyPlan()}
            disabled={draftingPlan}
            className="border border-black/15 px-4 py-2 text-xs transition-colors hover:border-black/35 disabled:opacity-40"
          >
            {draftingPlan ? 'Drafting...' : 'AI draft'}
          </button>
        </div>
      </div>

      {planningSignals.length > 0 && (
        <div className="mt-4 border border-amber-200 bg-amber-50 px-3 py-3">
          <p className="text-[0.6rem] uppercase tracking-[0.14em] text-amber-700">Planning signals</p>
          <div className="mt-2 space-y-1">
            {planningSignals.slice(0, 5).map((signal) => (
              <p key={signal} className="text-xs leading-relaxed text-black/55">{signal}</p>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_0.75fr_10rem]">
        <label className="block">
          <span className="text-xs text-black/45">Client note</span>
          <textarea
            value={planDraft.client_note}
            onChange={(event) => setPlanDraft((current) => ({ ...current, client_note: event.target.value }))}
            rows={3}
            className="mt-1 w-full resize-none border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/35"
            placeholder="What the client should see at the top of the week."
          />
        </label>
        <label className="block">
          <span className="text-xs text-black/45">Coach summary</span>
          <textarea
            value={planDraft.coach_summary}
            onChange={(event) => setPlanDraft((current) => ({ ...current, coach_summary: event.target.value }))}
            rows={3}
            className="mt-1 w-full resize-none border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/35"
            placeholder="Private planning context."
          />
        </label>
        <div className="grid gap-2">
          <label className="block">
            <span className="text-xs text-black/45">Regular slot</span>
            <input
              value={planDraft.regular_slot}
              onChange={(event) => setPlanDraft((current) => ({ ...current, regular_slot: event.target.value }))}
              className="mt-1 w-full border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/35"
              placeholder="Tue 7am"
            />
          </label>
          <label className="block">
            <span className="text-xs text-black/45">Slot status</span>
            <select
              value={planDraft.regular_slot_status}
              onChange={(event) => setPlanDraft((current) => ({ ...current, regular_slot_status: event.target.value as PTWeeklyPlanSlotStatus }))}
              className="mt-1 w-full border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/35"
            >
              {(Object.keys(SLOT_STATUS_LABELS) as PTWeeklyPlanSlotStatus[]).map((value) => (
                <option key={value} value={value}>{SLOT_STATUS_LABELS[value]}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-[0.6rem] uppercase tracking-[0.16em] text-black/35">Plan items</p>
        <button
          type="button"
          onClick={() => addPlanItem()}
          className="border border-black/15 px-3 py-1.5 text-xs transition-colors hover:border-black/35"
        >
          Add item
        </button>
      </div>

      <div className="mt-3 space-y-3">
        {planDraft.items.length === 0 ? (
          <p className="border border-dashed border-black/10 px-4 py-5 text-sm text-black/35">No plan items yet.</p>
        ) : (
          planDraft.items.map((item) => {
            const linkedValue = item.linked_phase_index !== '' && item.linked_day_index !== ''
              ? `${item.linked_phase_index}:${item.linked_day_index}`
              : '';
            return (
              <div key={item.local_id} className="border border-black/8 bg-[#fbfbf8] p-3">
                <div className="grid gap-2 md:grid-cols-[9rem_9rem_1fr_8rem]">
                  <select
                    value={item.item_type}
                    onChange={(event) => {
                      const type = event.target.value as PTWeeklyPlanItemType;
                      patchPlanItem(item.local_id, {
                        item_type: type,
                        title: item.title || PLAN_ITEM_LABELS[type],
                        confirmation_status: type === 'pt_session' ? 'needs_confirmation' : 'none',
                      });
                    }}
                    className="border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/35"
                  >
                    {PLAN_ITEM_TYPES.map((type) => (
                      <option key={type} value={type}>{PLAN_ITEM_LABELS[type]}</option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={item.scheduled_date}
                    onChange={(event) => patchPlanItem(item.local_id, { scheduled_date: event.target.value })}
                    className="border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/35"
                  />
                  <input
                    value={item.title}
                    onChange={(event) => patchPlanItem(item.local_id, { title: event.target.value })}
                    className="min-w-0 border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/35"
                    placeholder="Item title"
                  />
                  <select
                    value={item.status}
                    onChange={(event) => patchPlanItem(item.local_id, { status: event.target.value as PTWeeklyPlanItemStatus })}
                    className="border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/35"
                  >
                    {(Object.keys(ITEM_STATUS_LABELS) as PTWeeklyPlanItemStatus[]).map((value) => (
                      <option key={value} value={value}>{ITEM_STATUS_LABELS[value]}</option>
                    ))}
                  </select>
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-[1fr_12rem_12rem_4rem]">
                  <textarea
                    value={item.details}
                    onChange={(event) => patchPlanItem(item.local_id, { details: event.target.value })}
                    rows={2}
                    className="min-w-0 resize-none border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/35"
                    placeholder="Details"
                  />
                  <select
                    value={item.confirmation_status}
                    onChange={(event) => patchPlanItem(item.local_id, { confirmation_status: event.target.value as PTWeeklyPlanConfirmationStatus })}
                    className="border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/35"
                  >
                    {(Object.keys(CONFIRMATION_LABELS) as PTWeeklyPlanConfirmationStatus[]).map((value) => (
                      <option key={value} value={value}>{CONFIRMATION_LABELS[value]}</option>
                    ))}
                  </select>
                  <select
                    value={linkedValue}
                    onChange={(event) => {
                      if (!event.target.value || !activeAssignment) {
                        patchPlanItem(item.local_id, { linked_assignment_id: '', linked_phase_index: '', linked_day_index: '' });
                        return;
                      }
                      const [phaseIndex, dayIndex] = event.target.value.split(':');
                      patchPlanItem(item.local_id, {
                        linked_assignment_id: activeAssignment.id,
                        linked_phase_index: phaseIndex,
                        linked_day_index: dayIndex,
                      });
                    }}
                    className="border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/35"
                  >
                    <option value="">No workout link</option>
                    {activeWorkoutOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removePlanItem(item.local_id)}
                    className="border border-black/10 bg-white px-3 py-2 text-xs text-black/40 transition-colors hover:border-red-300 hover:text-red-600"
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void saveWeeklyPlan(false)}
          disabled={savingPlan}
          className="border border-black/20 px-4 py-2 text-sm transition-colors hover:bg-black hover:text-white disabled:opacity-40"
        >
          Save draft
        </button>
        <button
          type="button"
          onClick={() => void saveWeeklyPlan(true)}
          disabled={savingPlan || planDraft.items.length === 0}
          className="border border-black bg-black px-5 py-2 text-sm text-white transition-colors hover:bg-white hover:text-black disabled:opacity-40"
        >
          Publish to client
        </button>
      </div>
    </div>
  );

  const addGoal = async () => {
    if (!newGoal.title.trim()) return;
    const { data, error } = await supabase
      .from('pt_client_goals')
      .insert({
        client_id: client.id,
        goal_type: newGoal.goal_type.trim() || 'general',
        title: newGoal.title.trim(),
        target_value: newGoal.target_value ? Number(newGoal.target_value) : null,
        current_value: newGoal.current_value ? Number(newGoal.current_value) : null,
        unit: newGoal.unit.trim() || null,
        target_date: newGoal.target_date || null,
        notes: newGoal.notes.trim() || null,
        status: 'active',
      })
      .select('*')
      .single();

    if (error || !data) {
      setStatus(error?.message ?? 'Could not add goal.');
      return;
    }

    setGoals((current) => [data as PTClientGoal, ...current]);
    setNewGoal({ goal_type: 'general', title: '', target_value: '', current_value: '', unit: '', target_date: '', notes: '' });
    setStatus('Goal added.');
  };

  const updateGoalStatus = async (goalId: string, nextStatus: PTClientGoal['status']) => {
    const { error } = await supabase
      .from('pt_client_goals')
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq('id', goalId);

    if (error) {
      setStatus(error.message);
      return;
    }

    setGoals((current) => current.map((goal) => (goal.id === goalId ? { ...goal, status: nextStatus } : goal)));
  };

  const generateReview = async (reviewType: 'weekly' | 'monthly') => {
    setReviewBusy(reviewType);
    setStatus(reviewType === 'weekly' ? 'Generating weekly review...' : 'Generating monthly summary...');

    const periodStart = reviewType === 'weekly' ? selectedWeekStart : selectedMonthStart;
    const periodEnd = reviewType === 'weekly' ? addDays(selectedWeekStart, 6) : selectedMonthEnd;

    const { data, error } = await supabase.functions.invoke<ReviewAgentResponse>('generate-pt-review', {
      body: {
        client_id: client.id,
        review_type: reviewType,
        period_start: periodStart,
      },
    });

    if (error || data?.error || !data) {
      setStatus(error?.message ?? data?.error ?? 'Could not generate review.');
      setReviewBusy(null);
      return;
    }

    const { data: savedReview, error: saveError } = await supabase
      .from('pt_coaching_reviews')
      .upsert({
        client_id: client.id,
        review_type: reviewType,
        status: reviewType === 'monthly' ? 'final' : 'draft',
        period_start: data.period_start,
        period_end: data.period_end,
        total_items: data.total_items,
        completed_items: data.completed_items,
        skipped_items: data.skipped_items,
        adherence_pct: data.adherence_pct,
        metrics_summary: data.metrics_summary,
        performance_summary: data.performance_summary,
        client_feedback: data.client_feedback,
        what_got_done: data.what_got_done,
        what_was_missed: data.what_was_missed,
        suggested_changes: data.suggested_changes,
        pedro_summary: data.pedro_summary,
        client_summary: data.client_summary,
        body_snapshot: data.body_snapshot,
        performance_snapshot: data.performance_snapshot,
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'client_id,review_type,period_start' })
      .select('*')
      .single();

    if (saveError || !savedReview) {
      setStatus(saveError?.message ?? 'Review was generated but could not be saved.');
      setReviewBusy(null);
      return;
    }

    setReviews((current) => [
      savedReview as PTCoachingReview,
      ...current.filter((review) => (
        !(review.review_type === reviewType && review.period_start === data.period_start)
      )),
    ]);
    setStatus(reviewType === 'weekly' ? 'Weekly review saved.' : 'Monthly summary saved.');
    setReviewBusy(null);
  };

  const renderMetricDelta = (
    label: string,
    current: number | null | undefined,
    previous: number | null | undefined,
    unit: string,
  ) => {
    const delta = current !== null && current !== undefined && previous !== null && previous !== undefined
      ? Number((Number(current) - Number(previous)).toFixed(1))
      : null;

    return (
      <div className="border border-black/8 bg-white px-3 py-3">
        <p className="text-[0.6rem] uppercase tracking-[0.14em] text-black/35">{label}</p>
        <p className="mt-2 text-lg font-medium text-black">{metricValue(current ?? null, unit)}</p>
        <p className="mt-1 text-xs text-black/45">
          {delta === null
            ? 'Need one more check-in'
            : delta === 0
              ? 'No change'
              : `${delta > 0 ? '+' : ''}${delta}${unit}`}
        </p>
      </div>
    );
  };

  const startAgentDictation = () => {
    const SR = getSR();
    if (!SR) {
      setAgentStatus('Browser dictation is not available. Type the instruction instead.');
      return;
    }

    const recognition = new SR();
    agentSpeechRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-AU';
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result?.isFinal) {
          const transcript = result[0]?.transcript ?? '';
          if (transcript) {
            setAgentInstructions((current) => (current ? `${current} ${transcript}` : transcript).trim());
          }
        }
      }
    };
    recognition.onend = () => {
      setAgentListening(false);
      agentSpeechRef.current = null;
    };
    recognition.start();
    setAgentListening(true);
    setAgentStatus('');
  };

  const stopAgentDictation = () => {
    agentSpeechRef.current?.stop();
  };

  const runProgrammingAgent = async (mode: 'new_programme' | 'revise_programme') => {
    if (mode === 'revise_programme' && !activeAssignment) return;

    if (mode === 'new_programme') {
      const draftKey = `pt-programme-prefill:${client.id}:${Date.now()}`;
      sessionStorage.setItem(draftKey, JSON.stringify({
        client_id: client.id,
        instructions: agentInstructions.trim(),
        created_at: new Date().toISOString(),
      }));
      router.push(`/dashboard/pt/programmes/new?prefillKey=${encodeURIComponent(draftKey)}`);
      return;
    }

    setAgentBusy(mode);
    setAgentStatus('Drafting revision...');

    const { data, error } = await supabase.functions.invoke<ProgrammingAgentResponse>('pt-programming-agent', {
      body: {
        client_id: client.id,
        assignment_id: mode === 'revise_programme' ? activeAssignment?.id : undefined,
        mode,
        instructions: agentInstructions.trim() || undefined,
      },
    });

    if (error || data?.error || !data?.programme) {
      setAgentStatus(`Error: ${data?.error ?? error?.message ?? 'The programming agent did not return a draft.'}`);
      setAgentBusy(null);
      return;
    }

    const draftKey = `pt-programming-agent:${mode}:${activeAssignment?.id}:${Date.now()}`;
    sessionStorage.setItem(draftKey, JSON.stringify({ ...data, created_at: new Date().toISOString() }));

    const params = new URLSearchParams({ draftKey });
    if (activeAssignment) {
      router.push(`/dashboard/pt/programmes/${activeAssignment.id}/edit?${params.toString()}`);
    }
  };

  return (
    <div className="max-w-3xl px-5 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <div className="flex items-center gap-3 mb-8">
        <Link href="/dashboard/pt/clients" className="text-black/30 hover:text-black text-sm transition-colors">
          ← Clients
        </Link>
      </div>

      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-black/8 flex items-center justify-center text-xl font-medium text-black/50">
            {client.name.charAt(0).toUpperCase()}
          </div>
          <div>
            {editing ? (
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="font-display text-2xl font-light border-b border-black/20 outline-none bg-transparent"
              />
            ) : (
              <h1 className="font-display text-2xl font-light">{client.name}</h1>
            )}
            <p className="text-sm text-black/40 mt-0.5">{client.email}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={client.status}
            onChange={async (e) => {
              const newStatus = e.target.value as PTClient['status'];
              await supabase.from('pt_clients').update({ status: newStatus }).eq('id', client.id);
              setClient((c) => ({ ...c, status: newStatus }));
            }}
            className={`text-xs border px-2 py-1 rounded-full cursor-pointer outline-none ${STATUS_COLORS[client.status]}`}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
          {!editing && (
            <button onClick={() => setEditing(true)} className="text-xs border border-black/20 px-3 py-1 hover:bg-black hover:text-white transition-colors">
              Edit
            </button>
          )}
        </div>
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <div className="border border-black/8 px-4 py-4">
          <p className="text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1">Account</p>
          <p className="text-sm font-medium">
            {accountIsLive ? (
              <span className="text-green-600">Live</span>
            ) : (
              <span className="text-amber-600">Awaiting setup</span>
            )}
          </p>
          {accountDetail && (
            <p className="text-xs text-black/30 mt-0.5">
              {accountDetail}
            </p>
          )}
        </div>
        <div className="border border-black/8 px-4 py-4">
          <p className="text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1">Last login</p>
          <p className="text-sm font-medium">
            {lastLogin
              ? new Date(lastLogin.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
              : 'Never'}
          </p>
        </div>
        <div className="border border-black/8 px-4 py-4">
          <p className="text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1">Sessions left</p>
          {editing ? (
            <input
              type="number"
              min={0}
              value={form.sessions_remaining}
              onChange={(e) => setForm((f) => ({ ...f, sessions_remaining: parseInt(e.target.value) || 0 }))}
              className="w-20 border-b border-black/20 text-sm font-medium outline-none bg-transparent"
            />
          ) : (
            <p className={`text-sm font-medium ${client.sessions_remaining <= 3 ? 'text-amber-600' : ''}`}>
              {client.sessions_remaining}
            </p>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-5 mb-8">
        <div>
          <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-2">Goals</label>
          {editing ? (
            <input
              value={form.goals}
              onChange={(e) => setForm((f) => ({ ...f, goals: e.target.value }))}
              className="w-full border border-black/10 px-3 py-2.5 text-sm outline-none focus:border-black/40"
            />
          ) : (
            <p className="text-sm text-black/60">{client.goals || '—'}</p>
          )}
        </div>
        <div>
          <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-2">Notes</label>
          {editing ? (
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={3}
              className="w-full border border-black/10 px-3 py-2.5 text-sm outline-none focus:border-black/40 resize-none"
            />
          ) : (
            <p className="text-sm text-black/60">{client.notes || '—'}</p>
          )}
        </div>
      </div>

      {editing && (
        <div className="grid md:grid-cols-2 gap-5 mb-8">
          <div>
            <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-2">Regular slot</label>
            <input
              value={form.regular_training_slot}
              onChange={(e) => setForm((f) => ({ ...f, regular_training_slot: e.target.value }))}
              className="w-full border border-black/10 px-3 py-2.5 text-sm outline-none focus:border-black/40"
              placeholder="e.g. Tuesday 7am"
            />
          </div>
          <div>
            <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-2">Event goal</label>
            <input
              value={form.event_goal}
              onChange={(e) => setForm((f) => ({ ...f, event_goal: e.target.value }))}
              className="w-full border border-black/10 px-3 py-2.5 text-sm outline-none focus:border-black/40"
              placeholder="e.g. Coastal Classic"
            />
          </div>
          <div>
            <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-2">Coaching focus</label>
            <textarea
              value={form.coaching_focus}
              onChange={(e) => setForm((f) => ({ ...f, coaching_focus: e.target.value }))}
              rows={3}
              className="w-full resize-none border border-black/10 px-3 py-2.5 text-sm outline-none focus:border-black/40"
              placeholder="The current lifestyle coaching priority."
            />
          </div>
          <div>
            <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-2">Lifestyle context</label>
            <textarea
              value={form.lifestyle_context}
              onChange={(e) => setForm((f) => ({ ...f, lifestyle_context: e.target.value }))}
              rows={3}
              className="w-full resize-none border border-black/10 px-3 py-2.5 text-sm outline-none focus:border-black/40"
              placeholder="Golf, running, work rhythm, nutrition, travel, recovery."
            />
          </div>
        </div>
      )}

      {editing && (
        <div className="flex gap-3 mb-8">
          <button onClick={() => setEditing(false)} className="border border-black/20 px-5 py-2 text-sm hover:bg-black/5 transition-colors">
            Cancel
          </button>
          <button onClick={save} disabled={saving} className="border border-black bg-black text-white px-5 py-2 text-sm disabled:opacity-40">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}

      <WeeklyClientProgress
        clientId={client.id}
        nutritionLogs={nutritionLogs}
        workoutLogs={workoutLogs}
        weeklySetLogs={weeklySetLogs}
        priorSetLogs={priorSetLogs}
        dailyTargets={dailyTargets}
      />

      <div className="border-t border-black/8 pt-6 mb-8">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Coaching</h2>
          {coachingTasks.length > 0 && (
            <span className="border border-amber-200 bg-amber-50 px-2 py-1 text-[0.6rem] uppercase tracking-[0.12em] text-amber-700">
              {coachingTasks.length} open
            </span>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <div className="border border-black/10 bg-[#fbfbf8] px-6 py-5">
              <p className="text-[0.6rem] uppercase tracking-[0.16em] text-black/35">Client 360</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-black/35">Regular slot</p>
                  <p className="mt-1 text-sm text-black/70">{client.regular_training_slot || 'Not set'}</p>
                </div>
                <div>
                  <p className="text-xs text-black/35">Event goal</p>
                  <p className="mt-1 text-sm text-black/70">{client.event_goal || 'Not set'}</p>
                </div>
                <div>
                  <p className="text-xs text-black/35">Coaching focus</p>
                  <p className="mt-1 text-sm leading-relaxed text-black/70">{client.coaching_focus || 'Not set'}</p>
                </div>
                <div>
                  <p className="text-xs text-black/35">Lifestyle context</p>
                  <p className="mt-1 text-sm leading-relaxed text-black/70">{client.lifestyle_context || 'Not set'}</p>
                </div>
              </div>
            </div>

            <div className="border border-black/10 bg-white px-6 py-5">
              <p className="text-[0.6rem] uppercase tracking-[0.16em] text-black/35">Nutrition brain</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
                  <p className="text-xs text-black/35">Body profile</p>
                  <p className="mt-1 text-sm text-black/70">
                    {client.height_cm ? `${client.height_cm}cm` : '-'} / {client.current_weight_kg ? `${client.current_weight_kg}kg` : '-'}
                  </p>
                </div>
                <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
                  <p className="text-xs text-black/35">Activity</p>
                  <p className="mt-1 text-sm text-black/70">{client.activity_tag?.replace(/_/g, ' ') || 'Not set'}</p>
                </div>
                <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
                  <p className="text-xs text-black/35">Daily target</p>
                  <p className="mt-1 text-sm text-black/70">
                    {dailyTargets?.calories ? `${dailyTargets.calories} kcal` : 'Not set'}
                  </p>
                </div>
              </div>
              {dailyTargets && (
                <p className="mt-3 text-xs text-black/50">
                  Protein {dailyTargets.protein_g ?? '-'}g / Carbs {dailyTargets.carbs_g ?? '-'}g / Fat {dailyTargets.fat_g ?? '-'}g / Fibre {dailyTargets.fibre_g ?? '-'}g
                </p>
              )}
              {currentPhaseNutrition && (
                <div className="mt-3 border-t border-black/8 pt-3">
                  <p className="text-xs font-medium text-black/70">{currentPhaseNutrition.phase_title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-black/50">
                    {String((currentPhaseNutrition.recommendations?.strategy ?? currentPhaseNutrition.recommendations?.client_summary ?? 'Phase nutrition is approved.') as string)}
                  </p>
                </div>
              )}
              {latestBrainReport && (
                <div className="mt-3 border-t border-black/8 pt-3">
                  <p className="text-xs text-black/35">Latest weekly brain report - {formatDate(latestBrainReport.week_start)}</p>
                  <p className="mt-1 text-xs leading-relaxed text-black/55">{latestBrainReport.coach_summary || latestBrainReport.nutrition_summary || 'Report saved.'}</p>
                </div>
              )}
            </div>

            <div className="border border-black/10 px-6 py-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[0.6rem] uppercase tracking-[0.16em] text-black/35">Latest check-in</p>
                  {latestCheckin ? (
                    <p className="mt-2 text-sm font-medium">Week of {formatDate(latestCheckin.week_start)}</p>
                  ) : (
                    <p className="mt-2 text-sm text-black/45">No check-in yet.</p>
                  )}
                </div>
                {latestCheckin && latestCheckin.status === 'submitted' && (
                  <button
                    type="button"
                    onClick={() => void markCheckinReviewed(latestCheckin.id)}
                    className="shrink-0 border border-black/15 px-3 py-1.5 text-xs text-black/50 transition-colors hover:border-black hover:text-black"
                  >
                    Mark reviewed
                  </button>
                )}
              </div>
              {latestCheckin && (
                <div className="mt-4 space-y-3">
                  <p className="text-sm leading-relaxed text-black/75">{latestCheckin.client_focus || 'No focus written.'}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <p className="text-xs text-black/45"><span className="text-black/70">Injuries:</span> {latestCheckin.injuries || '-'}</p>
                    <p className="text-xs text-black/45"><span className="text-black/70">Nutrition:</span> {latestCheckin.nutrition_focus || '-'}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="border border-black/8 bg-black/3 px-2 py-1 text-xs text-black/45">Soreness {scoreLabel(latestCheckin.soreness)}</span>
                    <span className="border border-black/8 bg-black/3 px-2 py-1 text-xs text-black/45">Stress {scoreLabel(latestCheckin.stress)}</span>
                  </div>
                </div>
              )}
            </div>

            {checkinSessions.length > 0 && (
              <div className="border border-black/10 px-6 py-5">
                <p className="text-[0.6rem] uppercase tracking-[0.16em] text-black/35">AI Check-in Sessions</p>
                <div className="mt-3 space-y-4">
                  {checkinSessions.map((session, index) => (
                    <div key={session.id} className={`space-y-3 ${index > 0 ? 'border-t border-black/8 pt-3' : ''}`}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium">Week of {formatDate(session.week_start)}</p>
                        <span className={`border px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.08em] ${
                          session.status === 'completed'
                            ? 'border-green-200 bg-green-50 text-green-700'
                            : 'border-amber-200 bg-amber-50 text-amber-700'
                        }`}>
                          {session.status === 'completed' ? 'Completed' : 'In progress'}
                        </span>
                      </div>
                      {session.ai_weekly_focus && (
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div className="border border-black/8 bg-[#fbfbf8] px-3 py-2">
                            <p className="text-[0.6rem] uppercase tracking-[0.1em] text-black/35">Exercise</p>
                            <p className="mt-1 text-xs leading-relaxed text-black/70">{session.ai_weekly_focus.exercise}</p>
                          </div>
                          <div className="border border-black/8 bg-[#fbfbf8] px-3 py-2">
                            <p className="text-[0.6rem] uppercase tracking-[0.1em] text-black/35">Nutrition</p>
                            <p className="mt-1 text-xs leading-relaxed text-black/70">{session.ai_weekly_focus.nutrition}</p>
                          </div>
                          <div className="border border-black/8 bg-[#fbfbf8] px-3 py-2">
                            <p className="text-[0.6rem] uppercase tracking-[0.1em] text-black/35">Sleep</p>
                            <p className="mt-1 text-xs leading-relaxed text-black/70">{session.ai_weekly_focus.sleep}</p>
                          </div>
                        </div>
                      )}
                      {session.activity_selections && session.activity_selections.length > 0 && (
                        <div>
                          <p className="text-xs text-black/45">Activities booked:</p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {session.activity_selections.map((sel, i) => (
                              <span key={i} className="border border-black/8 bg-[#fbfbf8] px-2 py-1 text-xs text-black/60">
                                {sel.activity} - {sel.suggested_date}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {(session.injury_tips || session.stress_tips || session.nutrition_tips) && (
                        <div className="space-y-1.5">
                          {session.injury_tips && (
                            <p className="text-xs text-black/55"><span className="text-black/70">Injury tips:</span> {session.injury_tips}</p>
                          )}
                          {session.stress_tips && (
                            <p className="text-xs text-black/55"><span className="text-black/70">Stress tips:</span> {session.stress_tips}</p>
                          )}
                          {session.nutrition_tips && (
                            <p className="text-xs text-black/55"><span className="text-black/70">Nutrition tips:</span> {session.nutrition_tips}</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="border border-black/10 px-6 py-5">
              <p className="text-[0.6rem] uppercase tracking-[0.16em] text-black/35">Open loops</p>
              {coachingTasks.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {coachingTasks.map((task) => (
                    <div key={task.id} className="flex items-start justify-between gap-3 border border-amber-200 bg-amber-50 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-black/80">{task.title}</p>
                        {task.details && <p className="mt-1 text-xs leading-relaxed text-black/50">{task.details}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => void markTaskDone(task.id)}
                        className="shrink-0 text-xs text-amber-700 underline-offset-2 hover:underline"
                      >
                        Done
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-black/45">No coaching tasks open.</p>
              )}
            </div>

            <div className="border border-black/10 px-6 py-5">
              <p className="text-[0.6rem] uppercase tracking-[0.16em] text-black/35">Latest metrics</p>
              {latestMetric ? (
                <div className="mt-3">
                  <p className="text-sm font-medium">{formatDate(latestMetric.measured_at)}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <p className="text-xs text-black/45">Weight <span className="block text-sm text-black/70">{metricValue(latestMetric.weight_kg, 'kg')}</span></p>
                    <p className="text-xs text-black/45">Waist <span className="block text-sm text-black/70">{metricValue(latestMetric.waist_cm, 'cm')}</span></p>
                    <p className="text-xs text-black/45">Body fat <span className="block text-sm text-black/70">{metricValue(latestMetric.body_fat_pct, '%')}</span></p>
                    <p className="text-xs text-black/45">Muscle <span className="block text-sm text-black/70">{metricValue(latestMetric.muscle_mass_kg, 'kg')}</span></p>
                  </div>
                  {latestMetric.notes && <p className="mt-2 text-xs leading-relaxed text-black/45">{latestMetric.notes}</p>}
                </div>
              ) : (
                <p className="mt-3 text-sm text-black/45">No metrics logged yet.</p>
              )}
            </div>

            <div className="border border-black/10 px-6 py-5">
              <p className="text-[0.6rem] uppercase tracking-[0.16em] text-black/35">Progress snapshot</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {renderMetricDelta('Weight', weightPair.current?.weight_kg, weightPair.previous?.weight_kg, 'kg')}
                {renderMetricDelta('Waist', waistPair.current?.waist_cm, waistPair.previous?.waist_cm, 'cm')}
                {renderMetricDelta('Body fat', bodyFatPair.current?.body_fat_pct, bodyFatPair.previous?.body_fat_pct, '%')}
                {renderMetricDelta('Muscle', musclePair.current?.muscle_mass_kg, musclePair.previous?.muscle_mass_kg, 'kg')}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
                  <p className="text-[0.6rem] uppercase tracking-[0.14em] text-black/35">This week</p>
                  <p className="mt-2 text-lg font-medium">
                    {weeklyAdherence.adherencePct === null ? '-' : `${weeklyAdherence.adherencePct}%`}
                  </p>
                  <p className="mt-1 text-xs text-black/45">
                    {weeklyAdherence.done}/{weeklyAdherence.total} items done
                  </p>
                </div>
                <div className="border border-black/8 bg-[#fbfbf8] px-3 py-3">
                  <p className="text-[0.6rem] uppercase tracking-[0.14em] text-black/35">This month</p>
                  <p className="mt-2 text-lg font-medium">
                    {monthlyAdherence.adherencePct === null ? '-' : `${monthlyAdherence.adherencePct}%`}
                  </p>
                  <p className="mt-1 text-xs text-black/45">
                    {monthlyAdherence.done}/{monthlyAdherence.total} items done
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {renderWeeklyPlanBuilder()}

        <div className="mt-4 border border-black/10 px-6 py-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-[0.6rem] uppercase tracking-[0.16em] text-black/35">Review loop</p>
              <p className="mt-1 text-sm text-black/45">
                Generate a coach-facing weekly review or a client-facing monthly summary from adherence, metrics, notes, resets, and messages.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void generateReview('weekly')}
                disabled={reviewBusy !== null}
                className="border border-black/20 px-4 py-2 text-xs transition-colors hover:bg-black hover:text-white disabled:opacity-40"
              >
                {reviewBusy === 'weekly' ? 'Generating...' : 'Generate weekly review'}
              </button>
              <button
                type="button"
                onClick={() => void generateReview('monthly')}
                disabled={reviewBusy !== null}
                className="border border-black bg-black px-4 py-2 text-xs text-white transition-colors hover:bg-white hover:text-black disabled:opacity-40"
              >
                {reviewBusy === 'monthly' ? 'Generating...' : 'Generate monthly summary'}
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="border border-black/8 bg-[#fbfbf8] px-4 py-4">
              <p className="text-[0.6rem] uppercase tracking-[0.14em] text-black/35">Weekly review</p>
              <p className="mt-1 text-xs text-black/35">{formatWeekRange(selectedWeekStart)}</p>
              {selectedWeeklyReview ? (
                <div className="mt-3 space-y-3">
                  <p className="text-sm leading-relaxed text-black/75">{selectedWeeklyReview.pedro_summary || selectedWeeklyReview.performance_summary}</p>
                  <p className="text-xs text-black/45">{selectedWeeklyReview.metrics_summary}</p>
                  <p className="text-xs text-black/45"><span className="text-black/70">Done:</span> {selectedWeeklyReview.what_got_done || '-'}</p>
                  <p className="text-xs text-black/45"><span className="text-black/70">Missed:</span> {selectedWeeklyReview.what_was_missed || '-'}</p>
                  <p className="text-xs text-black/45"><span className="text-black/70">Next:</span> {selectedWeeklyReview.suggested_changes || '-'}</p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-black/45">No weekly review generated yet.</p>
              )}
            </div>

            <div className="border border-black/8 bg-[#fbfbf8] px-4 py-4">
              <p className="text-[0.6rem] uppercase tracking-[0.14em] text-black/35">Monthly summary</p>
              <p className="mt-1 text-xs text-black/35">
                {formatDate(selectedMonthStart)} - {formatDate(selectedMonthEnd)}
              </p>
              {selectedMonthlyReview ? (
                <div className="mt-3 space-y-3">
                  <p className="text-sm leading-relaxed text-black/75">{selectedMonthlyReview.client_summary || selectedMonthlyReview.pedro_summary}</p>
                  <p className="text-xs text-black/45">{selectedMonthlyReview.metrics_summary}</p>
                  <p className="text-xs text-black/45">{selectedMonthlyReview.performance_summary}</p>
                  <p className="text-xs text-black/45"><span className="text-black/70">Feedback:</span> {selectedMonthlyReview.client_feedback || '-'}</p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-black/45">No monthly summary generated yet.</p>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 border border-black/10 px-6 py-5">
          <p className="text-[0.6rem] uppercase tracking-[0.16em] text-black/35">Goals</p>
          {activeGoals.length > 0 && (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {activeGoals.map((goal) => (
                <div key={goal.id} className="border border-black/8 bg-[#fbfbf8] px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{goal.title}</p>
                      <p className="mt-1 text-xs text-black/45">
                        {getGoalProgressLabel(goal, metrics)}
                      </p>
                    </div>
                    <select
                      value={goal.status}
                      onChange={(event) => void updateGoalStatus(goal.id, event.target.value as PTClientGoal['status'])}
                      className="border border-black/10 bg-white px-2 py-1 text-[0.65rem] uppercase tracking-[0.08em] text-black/55 outline-none focus:border-black/35"
                    >
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                      <option value="completed">Completed</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 grid gap-2 md:grid-cols-[10rem_1fr_6rem_6rem_5rem_9rem]">
            <select value={newGoal.goal_type} onChange={(event) => setNewGoal((current) => ({ ...current, goal_type: event.target.value }))}
              className="border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/35">
              {GOAL_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <input value={newGoal.title} onChange={(event) => setNewGoal((current) => ({ ...current, title: event.target.value }))}
              className="border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/35" placeholder="Goal title" />
            <input value={newGoal.current_value} onChange={(event) => setNewGoal((current) => ({ ...current, current_value: event.target.value }))}
              className="border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/35" placeholder="Now" inputMode="decimal" />
            <input value={newGoal.target_value} onChange={(event) => setNewGoal((current) => ({ ...current, target_value: event.target.value }))}
              className="border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/35" placeholder="Target" inputMode="decimal" />
            <input value={newGoal.unit} onChange={(event) => setNewGoal((current) => ({ ...current, unit: event.target.value }))}
              className="border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/35" placeholder="Unit" />
            <input type="date" value={newGoal.target_date} onChange={(event) => setNewGoal((current) => ({ ...current, target_date: event.target.value }))}
              className="border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/35" />
          </div>
          <textarea value={newGoal.notes} onChange={(event) => setNewGoal((current) => ({ ...current, notes: event.target.value }))}
            rows={2} className="mt-2 w-full resize-none border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/35" placeholder="Goal notes or plain-English definition." />
          <button type="button" onClick={() => void addGoal()} disabled={!newGoal.title.trim()}
            className="mt-2 border border-black bg-black px-4 py-2 text-xs text-white transition-colors hover:bg-white hover:text-black disabled:opacity-30">
            Add goal
          </button>
        </div>
      </div>

      <div className="border-t border-black/8 pt-6 mb-8">
        <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-4">Programmes</h2>
        {assignmentList.length > 0 ? (
          <div className="space-y-3">
            <p className="text-xs text-black/40">
              The client only ever sees one programme. Toggle the one to show - turning a programme on switches the others off.
            </p>
            {assignmentList.map((a) => {
              const isActive = a.status === 'active';
              return (
                <div
                  key={a.id}
                  className={`flex items-center justify-between gap-4 border px-5 py-4 transition-colors ${isActive ? 'border-green-300 bg-green-50/40' : 'border-black/10'}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{a.name}</p>
                    <p className="text-xs text-black/40 mt-0.5">
                      {a.phase_count} phase{a.phase_count !== 1 ? 's' : ''} · {a.duration_weeks} weeks
                    </p>
                    <span className={`inline-block mt-2 text-xs border px-2 py-0.5 rounded-full transition-colors ${isActive ? 'border-green-300 bg-green-50 text-green-700' : 'border-black/15 text-black/40'}`}>
                      {isActive ? 'Active - client sees this' : 'Off'}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Link
                      href={`/dashboard/pt/programmes/${a.id}/edit`}
                      className="text-xs border border-black/20 px-3 py-1.5 hover:bg-black hover:text-white transition-colors"
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isActive}
                      aria-label={`${isActive ? 'Switch off' : 'Switch on'} ${a.name}`}
                      disabled={togglingId !== null}
                      onClick={() => void setActiveProgramme(a.id)}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-300 disabled:opacity-50 ${isActive ? 'bg-green-500' : 'bg-black/20'}`}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-300 ${isActive ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                </div>
              );
            })}
            {templates.length > 0 && (
              <details className="border border-black/8 px-4 py-3">
                <summary className="cursor-pointer text-xs text-black/45 hover:text-black">+ Assign another programme from a template</summary>
                <div className="mt-3 space-y-2">
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => assignProgramme(t.id)}
                      disabled={assigningId === t.id}
                      className="w-full text-left border border-black/10 px-4 py-3 hover:border-black/30 transition-colors disabled:opacity-40"
                    >
                      <p className="text-sm font-medium">{t.name}</p>
                      <p className="text-xs text-black/40">{t.phase_count} phases · {t.duration_weeks} weeks</p>
                    </button>
                  ))}
                </div>
              </details>
            )}
          </div>
        ) : (
          <div className="border border-black/8 px-6 py-5">
            <p className="text-sm text-black/40 mb-3">No programmes yet.</p>
            {templates.length > 0 ? (
              <div className="space-y-2">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => assignProgramme(t.id)}
                    disabled={assigningId === t.id}
                    className="w-full text-left border border-black/10 px-4 py-3 hover:border-black/30 hover:bg-black/2 transition-colors disabled:opacity-40"
                  >
                    <p className="text-sm font-medium">{t.name}</p>
                    <p className="text-xs text-black/40">{t.phase_count} phases · {t.duration_weeks} weeks</p>
                  </button>
                ))}
              </div>
            ) : (
              <Link href="/dashboard/pt/programmes" className="text-xs text-black/40 hover:text-black underline">
                Create a programme first
              </Link>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-black/8 pt-6 mb-8">
        <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-4">Programming Agent</h2>
        <div className="border border-black/10 bg-[#fbfbf8] px-6 py-5">
          <p className="text-sm text-black/55">
            New programmes open in the full programme creator so intake, movement analysis, exercise intelligence, and review all run in order. Revisions draft from this client's existing programme and history.
          </p>
          <textarea
            value={agentInstructions}
            onChange={(event) => setAgentInstructions(event.target.value)}
            rows={3}
            placeholder={activeAssignment ? 'Optional instruction for the revision...' : 'Optional instruction for the new programme...'}
            className="mt-4 w-full resize-none border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-black/40"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {agentListening ? (
              <>
                <span className="border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-600">Recording</span>
                <button
                  type="button"
                  onClick={stopAgentDictation}
                  className="border border-black bg-black px-4 py-2 text-xs text-white transition-colors hover:bg-white hover:text-black"
                >
                  Done
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={startAgentDictation}
                className="border border-black/15 px-4 py-2 text-xs transition-colors hover:border-black/30"
              >
                Voice
              </button>
            )}
            <button
              type="button"
              onClick={() => void runProgrammingAgent(activeAssignment ? 'revise_programme' : 'new_programme')}
              disabled={agentBusy !== null}
              className="border border-black bg-black px-5 py-2 text-sm text-white transition-colors hover:bg-white hover:text-black disabled:opacity-40"
            >
              {agentBusy
                ? 'Drafting...'
                : activeAssignment
                  ? 'Draft revision'
                  : 'Open programme creator'}
            </button>
          </div>
          {agentStatus && <p className="mt-3 text-xs text-black/45">{agentStatus}</p>}
        </div>
      </div>

      {/* 1RM Testing */}
      <div className="border-t border-black/8 pt-6 mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">1RM Results</h2>
          <button
            type="button"
            onClick={() => setOneRmModalOpen((open) => !open)}
            className="text-xs border border-black/15 px-3 py-1.5 hover:border-black/30 transition-colors"
          >
            {oneRmModalOpen ? 'Close' : 'Enter results'}
          </button>
        </div>

        {oneRmModalOpen && (
          <div className="border border-black/10 bg-[#fbfbf8] px-6 py-5 mb-4">
            <p className="text-xs text-black/45 mb-4">
              Enter tested weight and reps. Estimated 1RM uses Epley formula. Protocol: empty bar 6 reps, then 50 / 65 / 75 / 85% warm-up sets, then the max attempt.
            </p>
            <div className="space-y-3">
              {ONE_RM_EXERCISES.map((ex) => {
                const w = parseFloat(oneRmInputs[ex].weight);
                const r = parseInt(oneRmInputs[ex].reps, 10) || 1;
                const est = !Number.isNaN(w) && w > 0 ? epley1RM(w, r) : null;
                const goal = est ?? (w > 0 ? w : 0);
                const wuSets = goal > 0 ? warmUpSets(goal) : [];
                return (
                  <div key={ex} className="border border-black/8 bg-white px-4 py-3">
                    <p className="text-xs font-medium text-black mb-2">{ex}</p>
                    <div className="flex flex-wrap gap-2 items-end">
                      <div>
                        <p className="text-[0.58rem] text-black/35 mb-1">Tested weight (kg)</p>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={oneRmInputs[ex].weight}
                          onChange={(e) => setOneRmInputs((prev) => ({ ...prev, [ex]: { ...prev[ex], weight: e.target.value } }))}
                          className="w-24 border border-black/15 px-2 py-1.5 text-sm outline-none focus:border-black/40"
                          placeholder="e.g. 80"
                        />
                      </div>
                      <div>
                        <p className="text-[0.58rem] text-black/35 mb-1">Reps (1 = true max)</p>
                        <input
                          type="number"
                          min="1"
                          max="20"
                          value={oneRmInputs[ex].reps}
                          onChange={(e) => setOneRmInputs((prev) => ({ ...prev, [ex]: { ...prev[ex], reps: e.target.value } }))}
                          className="w-16 border border-black/15 px-2 py-1.5 text-sm outline-none focus:border-black/40"
                        />
                      </div>
                      {est !== null && (
                        <div className="pl-2">
                          <p className="text-[0.58rem] text-black/35 mb-1">Estimated 1RM</p>
                          <p className="text-sm font-medium text-black">{est} kg</p>
                        </div>
                      )}
                    </div>
                    {wuSets.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {wuSets.map((s) => (
                          <span key={s.label} className="border border-black/8 bg-black/3 px-2 py-0.5 text-[0.58rem] text-black/45">
                            {s.label}: {s.weight}kg x{s.reps}
                          </span>
                        ))}
                        <span className="border border-black bg-black px-2 py-0.5 text-[0.58rem] text-white">
                          1RM: {goal}kg x1
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void saveOneRmResults()}
                disabled={oneRmSaving}
                className="border border-black bg-black px-5 py-2 text-sm text-white transition-colors hover:bg-white hover:text-black disabled:opacity-40"
              >
                {oneRmSaving ? 'Saving...' : 'Save results'}
              </button>
              {activeAssignment && (
                <button
                  type="button"
                  onClick={() => void recalculateLoads()}
                  disabled={recalcBusy || oneRmTests.length === 0}
                  className="border border-black/20 px-4 py-2 text-xs hover:border-black/40 transition-colors disabled:opacity-40"
                >
                  {recalcBusy ? 'Recalculating...' : 'Recalculate programme loads'}
                </button>
              )}
              {activeAssignment && oneRmAdvancePhaseIndex !== null && (
                <button
                  type="button"
                  onClick={() => void advanceAfterOneRm()}
                  disabled={oneRmAdvanceBusy}
                  className="border border-amber-500 bg-amber-50 px-4 py-2 text-xs text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-40"
                >
                  {oneRmAdvanceBusy
                    ? 'Moving...'
                    : `Move to ${activeAssignment.programme.phases[oneRmAdvancePhaseIndex]?.title ?? 'next phase'}`}
                </button>
              )}
            </div>
            {oneRmStatus && <p className="mt-3 text-xs text-black/45">{oneRmStatus}</p>}
          </div>
        )}

        {oneRmTests.length > 0 ? (
          <div className="space-y-3">
            {oneRmTests.map((test) => (
              <div key={test.id} className="border border-black/8 px-4 py-3">
                <p className="text-[0.58rem] uppercase tracking-[0.12em] text-black/35 mb-2">
                  {new Date(`${test.tested_at}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
                <div className="flex flex-wrap gap-3">
                  {(test.results ?? []).map((r) => (
                    <div key={r.id} className="border border-black/8 bg-[#fbfbf8] px-3 py-2 min-w-[120px]">
                      <p className="text-[0.58rem] text-black/40">{r.exercise_name}</p>
                      <p className="text-sm font-medium text-black">{r.estimated_1rm_kg} kg</p>
                      {r.tested_reps !== 1 && r.tested_weight_kg && (
                        <p className="text-[0.55rem] text-black/30">{r.tested_weight_kg}kg x{r.tested_reps}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-black/35">No 1RM results yet. Enter after the testing session.</p>
        )}
      </div>

      {notes.length > 0 && (
        <div className="border-t border-black/8 pt-6 mb-8">
          <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-amber-600 mb-4">
            Notes ({notes.length})
          </h2>
          <div className="space-y-2">
            {notes.map((note) => (
              <div key={note.id} className="flex items-start justify-between gap-4 border border-amber-200 bg-amber-50 px-4 py-3">
                <div>
                  <p className="text-sm text-black/80">{note.content}</p>
                  {noteContextLabel(note) && (
                    <p className="mt-1 text-xs text-amber-700">{noteContextLabel(note)}</p>
                  )}
                  <p className="text-xs text-black/30 mt-1">
                    {new Date(note.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {noteFixHref(note) && (
                    <Link
                      href={noteFixHref(note)!}
                      className="text-xs text-amber-700 underline-offset-2 hover:underline"
                    >
                      Open fix
                    </Link>
                  )}
                  <button
                    onClick={async () => {
                      await supabase.from('pt_client_notes').update({ is_active: false }).eq('id', note.id);
                      setNotes((prev) => prev.filter((n) => n.id !== note.id));
                    }}
                    className="text-xs text-black/30 hover:text-black transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-black/8 pt-6 mb-8">
        <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-4">Client profile document</h2>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.doc,.docx,.txt,.md"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleUpload(file);
          }}
        />
        {client.document_url ? (
          <div className="flex items-center gap-3">
            <button
              onClick={() => void viewDocument()}
              className="text-sm border border-black/10 px-4 py-2 hover:bg-black/5 transition-colors"
            >
              View document
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="text-xs text-black/40 hover:text-black transition-colors"
            >
              Replace
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="border border-black/15 border-dashed px-6 py-4 text-sm text-black/40 hover:border-black/30 hover:text-black transition-colors w-full text-center"
          >
            {uploading ? 'Uploading…' : '+ Upload client profile (PDF, Word, or text)'}
          </button>
        )}
      </div>

      {status && <p className="text-xs text-black/50 mb-6">{status}</p>}

      <div className="border-t border-black/8 pt-6 flex flex-wrap items-center gap-3">
        <button
          onClick={sendInvite}
          disabled={inviting}
          className="border border-black/20 px-5 py-2 text-sm hover:bg-black hover:text-white transition-colors disabled:opacity-40"
        >
          {inviting ? 'Sending...' : client.password_created_at ? 'Resend login link' : 'Resend setup link'}
        </button>
        {client.password_created_at && (
          <Link
            href="/client-login"
            target="_blank"
            className="border border-black/20 px-5 py-2 text-sm hover:bg-black hover:text-white transition-colors"
          >
            Client login page
          </Link>
        )}
        <button
          onClick={() => setPasswordPanelOpen((open) => !open)}
          className="border border-black/20 px-5 py-2 text-sm hover:bg-black hover:text-white transition-colors"
        >
          Password
        </button>
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-xs text-red-400 hover:text-red-600 transition-colors ml-auto"
          >
            Delete client
          </button>
        ) : (
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-black/50">Are you sure?</span>
            <button onClick={deleteClient} className="text-xs text-red-600 font-medium hover:underline">
              Yes, delete
            </button>
            <button onClick={() => setConfirmDelete(false)} className="text-xs text-black/40 hover:text-black">
              Cancel
            </button>
          </div>
        )}
      </div>
      {passwordPanelOpen && (
        <div className="mt-4 border border-black/10 bg-[#fbfbf8] p-4">
          <p className="text-sm font-medium text-black">Client password</p>
          <p className="mt-1 text-xs leading-relaxed text-black/45">
            Current passwords are encrypted and cannot be viewed. Send the client a reset link, or create a new temporary password now.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() => void handlePasswordAction('send_reset')}
              disabled={passwordBusy}
              className="border border-black/20 px-4 py-2 text-sm hover:bg-black hover:text-white transition-colors disabled:opacity-40"
            >
              Send reset link
            </button>
            <button
              onClick={() => void handlePasswordAction('set_temporary_password')}
              disabled={passwordBusy}
              className="border border-black bg-black px-4 py-2 text-sm text-white transition-opacity hover:opacity-80 disabled:opacity-40"
            >
              Generate temporary password
            </button>
          </div>
          {temporaryPassword && (
            <div className="mt-4 border border-green-200 bg-green-50 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.15em] text-green-700">New temporary password</p>
              <p className="mt-2 break-all font-mono text-sm text-black">{temporaryPassword}</p>
              <p className="mt-2 text-xs text-black/45">
                Share this with the client once. They can change it from the forgot-password flow after login.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
