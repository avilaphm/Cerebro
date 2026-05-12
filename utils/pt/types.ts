export interface PTExercise {
  id: string;
  name: string;
  muscles: string[];
  purpose: string | null;
  equipment: string | null;
  video_url: string | null;
  cues: string[];
  tags: string[];
  source: 'manual' | 'spreadsheet' | 'ai';
}

export interface PTClient {
  id: string;
  name: string;
  email: string;
  status: 'invited' | 'active' | 'paused' | 'archived';
  goals: string | null;
  notes: string | null;
  user_id: string | null;
  sessions_remaining: number;
  document_url: string | null;
  password_created_at: string | null;
  lifestyle_context: string | null;
  regular_training_slot: string | null;
  coaching_focus: string | null;
  event_goal: string | null;
  created_at?: string;
}

export interface PTProgrammeExerciseBlockOverride {
  block_index: number;
  sets?: string;
  reps?: string;
  weight_pct?: string;
  notes?: string;
}

export interface PTProgrammeExercise {
  id: string;
  exercise_id: string | null;
  name: string;
  sets: string;
  reps: string;
  rest: string;
  notes: string;
  video_url: string | null;
  cues: string[];
  superset_id?: string | null;
  section_start?: string;
  week_overrides?: PTProgrammeExerciseBlockOverride[];
}

export interface PTProgrammeDay {
  id: string;
  title: string;
  focus: string;
  exercises: PTProgrammeExercise[];
}

export interface PTProgrammeWeekBlock {
  weeks: number;
  sets?: string;
  weight_pct?: string;
}

export interface PTProgrammePhase {
  id: string;
  title: string;
  focus: string;
  weeks: string;
  progression: string;
  week_blocks?: PTProgrammeWeekBlock[];
  days: PTProgrammeDay[];
}

export interface PTProgramme {
  phases: PTProgrammePhase[];
}

export interface PTProgramTemplate {
  id: string;
  name: string;
  description: string | null;
  goal: string | null;
  duration_weeks: number;
  phase_count: number;
  status: 'draft' | 'ready' | 'archived';
  programme: PTProgramme;
}

export interface PTProgramAssignment {
  id: string;
  client_id: string;
  template_id: string | null;
  name: string;
  goal: string | null;
  duration_weeks: number;
  phase_count: number;
  start_date: string | null;
  status: 'draft' | 'active' | 'completed' | 'paused' | 'archived';
  programme: PTProgramme;
  current_week: number;
  current_block_index: number;
  pt_clients?: Pick<PTClient, 'name' | 'email'> | null;
}

export interface PTSetLog {
  id: string;
  exercise_id: string | null;
  exercise_name: string;
  set_number: number;
  reps: number | null;
  weight: number | null;
  notes: string | null;
  created_at: string;
}

export interface PTMessage {
  id: string;
  client_id: string;
  sender: 'pt' | 'client';
  content: string;
  read_at: string | null;
  created_at: string;
}

export interface PTGroup {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface PTWeeklyCheckin {
  id: string;
  client_id: string;
  week_start: string;
  availability: string | null;
  golf_days: string | null;
  run_days: string | null;
  energy: number | null;
  soreness: number | null;
  sleep: number | null;
  stress: number | null;
  travel: string | null;
  injuries: string | null;
  nutrition_focus: string | null;
  nutrition_obstacles: string | null;
  client_focus: string | null;
  status: 'submitted' | 'reviewed' | 'archived';
  created_at: string;
  updated_at?: string;
}

export type PTWeeklyPlanStatus = 'draft' | 'published' | 'archived';
export type PTWeeklyPlanItemType =
  | 'pt_session'
  | 'solo_strength'
  | 'run'
  | 'golf_mobility'
  | 'recovery'
  | 'nutrition'
  | 'check_in';
export type PTWeeklyPlanItemStatus = 'planned' | 'done' | 'skipped' | 'moved';
export type PTWeeklyPlanConfirmationStatus = 'none' | 'needs_confirmation' | 'confirmed' | 'moved' | 'cancelled';
export type PTWeeklyPlanSlotStatus = 'unconfirmed' | 'confirmed' | 'moved' | 'cancelled';

export interface PTWeeklyPlan {
  id: string;
  client_id: string;
  week_start: string;
  status: PTWeeklyPlanStatus;
  coach_summary: string | null;
  client_note: string | null;
  regular_slot: string | null;
  regular_slot_status: PTWeeklyPlanSlotStatus;
  published_at: string | null;
  created_at: string;
  updated_at?: string;
}

export interface PTWeeklyPlanItem {
  id: string;
  plan_id: string;
  client_id: string;
  item_type: PTWeeklyPlanItemType;
  scheduled_date: string | null;
  title: string;
  details: string | null;
  linked_assignment_id: string | null;
  linked_phase_index: number | null;
  linked_day_index: number | null;
  status: PTWeeklyPlanItemStatus;
  confirmation_status: PTWeeklyPlanConfirmationStatus;
  sort_order: number;
  completed_at: string | null;
  created_at: string;
  updated_at?: string;
}

export interface PTClientMetric {
  id: string;
  client_id: string;
  measured_at: string;
  weight_kg: number | null;
  waist_cm: number | null;
  body_fat_pct: number | null;
  muscle_mass_kg: number | null;
  source: 'manual' | 'scale' | 'coach';
  photo_urls?: string[];
  notes: string | null;
  created_at: string;
}

export interface PTClientGoal {
  id: string;
  client_id: string;
  goal_type: string;
  title: string;
  target_value: number | null;
  current_value: number | null;
  unit: string | null;
  target_date: string | null;
  status: 'active' | 'paused' | 'completed' | 'archived';
  notes: string | null;
  created_at: string;
  updated_at?: string;
}

export interface PTCoachingTask {
  id: string;
  client_id: string;
  source_type: string;
  source_id: string | null;
  title: string;
  details: string | null;
  priority: 'low' | 'normal' | 'high';
  status: 'open' | 'done' | 'archived';
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at?: string;
}

export interface PTCoachingReview {
  id: string;
  client_id: string;
  review_type: 'weekly' | 'monthly';
  status: 'draft' | 'final' | 'archived';
  period_start: string;
  period_end: string;
  total_items: number;
  completed_items: number;
  skipped_items: number;
  adherence_pct: number | null;
  metrics_summary: string | null;
  performance_summary: string | null;
  client_feedback: string | null;
  what_got_done: string | null;
  what_was_missed: string | null;
  suggested_changes: string | null;
  pedro_summary: string | null;
  client_summary: string | null;
  body_snapshot: Record<string, unknown>;
  performance_snapshot: Record<string, unknown>;
  generated_at: string | null;
  created_at: string;
  updated_at?: string;
}
