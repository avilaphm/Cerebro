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
  primary_muscles: string[];
  secondary_muscles: string[];
  conditions: string[];
  setup_cues: string[];
  progression_ids: string[];
  regression_ids: string[];
}

export interface PTClient {
  id: string;
  name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
  gender: 'male' | 'female' | 'non_binary' | 'prefer_not_to_say' | null;
  date_of_birth: string | null;
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
  generation_run_id?: string | null;
  name: string;
  description: string | null;
  goal: string | null;
  duration_weeks: number;
  phase_count: number;
  status: 'draft' | 'ready' | 'archived';
  programme: PTProgramme;
  validation_summary?: Record<string, unknown>;
}

export type PTProgramGenerationStatus = 'draft' | 'running' | 'needs_review' | 'approved' | 'saved' | 'failed' | 'archived';

export interface PTProgramGenerationRun {
  id: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  client_id: string;
  assignment_id: string | null;
  task_type: string;
  phase_type: string | null;
  client_goal: string | null;
  current_command: string | null;
  status: PTProgramGenerationStatus;
  coaching_reasoning: Record<string, unknown>;
  phase_roadmap: unknown;
  programme_draft: PTProgramme;
  nutrition_draft: unknown;
  validation_summary: Record<string, unknown>;
  failure_reason: string | null;
  pt_clients?: Pick<PTClient, 'name' | 'email' | 'goals'> | null;
  pt_program_assignments?: Pick<PTProgramAssignment, 'id' | 'name' | 'goal'> | null;
}

export interface PTProgramGenerationStep {
  id: string;
  created_at: string;
  run_id: string;
  step_order: number;
  command_name: string;
  input_json: Record<string, unknown>;
  output_json: unknown;
  validation_json: Record<string, unknown>;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  failure_reason: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface PTKnowledgeRetrievalLog {
  id: string;
  created_at: string;
  run_id: string | null;
  step_id: string | null;
  task_type: string;
  phase_type: string | null;
  client_goal: string | null;
  question_or_decision: string;
  excerpts: unknown;
  applied_rules: unknown;
  referenced_documents: unknown;
  confidence_score: number | null;
  low_confidence: boolean;
}

export interface PTProgramReviewOutput {
  id: string;
  created_at: string;
  run_id: string | null;
  assignment_id: string | null;
  client_id: string;
  review_type: 'program' | 'nutrition' | 'system' | 'full';
  status: 'passed' | 'failed' | 'needs_review' | 'approved';
  findings: unknown;
  hard_rule_failures: unknown;
  repaired_output: unknown;
  reviewer_notes: string | null;
}

export interface PTProgramAssignment {
  id: string;
  client_id: string;
  template_id: string | null;
  generation_run_id?: string | null;
  name: string;
  goal: string | null;
  duration_weeks: number;
  phase_count: number;
  start_date: string | null;
  status: 'draft' | 'active' | 'completed' | 'paused' | 'archived';
  programme: PTProgramme;
  coach_review_status?: 'draft' | 'needs_review' | 'approved' | 'changes_requested';
  validation_summary?: Record<string, unknown>;
  nutrition_sync?: Record<string, unknown>;
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
  checkin_session_id: string | null;
  checkin_mode: 'form' | 'ai';
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
  | 'check_in'
  | 'pilates'
  | 'walk'
  | 'fitness_class';
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

export interface CheckinMessage {
  role: 'user' | 'assistant';
  content: string;
  ui_hint?: string;
  created_at: string;
}

export interface CheckinActivitySelection {
  activity: string;
  suggested_date: string;
  suggested_time: string;
  confirmed: boolean;
}

export interface CheckinWeeklyFocus {
  exercise: string;
  nutrition: string;
  sleep: string;
}

export interface PTSlotSuggestion {
  date: string;
  start_at: string;
  end_at: string;
  label: string;
}

export interface PTCheckinSession {
  id: string;
  client_id: string;
  week_start: string;
  status: 'in_progress' | 'completed';
  messages: CheckinMessage[];
  activity_selections: CheckinActivitySelection[] | null;
  pt_session_suggestions: PTSlotSuggestion[] | null;
  ai_weekly_focus: CheckinWeeklyFocus | null;
  injury_tips: string | null;
  stress_tips: string | null;
  nutrition_tips: string | null;
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

// ---- Client Brain System ----

export interface PTClientBrain {
  id: string;
  client_id: string;
  personality_notes: Record<string, string>;
  key_phrases: string[];
  open_loops: string[];
  milestones: string[];
  summary_current: string | null;
  summary_30d: string | null;
  summary_60d: string | null;
  summary_12m: string | null;
  last_session_summary: string | null;
  total_interactions: number;
  brain_version: number;
  coaching_reasoning: Record<string, unknown>;
  important_decisions: Array<Record<string, unknown>>;
  created_at: string;
  updated_at: string;
}

export interface PTClientNutritionDoc {
  id: string;
  client_id: string;
  typical_meals: Array<Record<string, unknown>>;
  favourite_foods: string[];
  foods_to_avoid: string[];
  nutrition_obstacles: string | null;
  eating_habits: Record<string, unknown>;
  current_week_avg: { protein_g?: number; carbs_g?: number; fat_g?: number; calories?: number; entries?: number };
  last_30d_avg: { protein_g?: number; carbs_g?: number; fat_g?: number; calories?: number };
  prev_60d_avg: { protein_g?: number; carbs_g?: number; fat_g?: number; calories?: number };
  last_12m_summary: string | null;
  recent_wins: string[];
  recurring_gaps: string[];
  daily_targets?: { protein_g?: number; carbs_g?: number; fat_g?: number; fibre_g?: number; calories?: number } | null;
  phase_nutrition_strategy: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PTClientExerciseDoc {
  id: string;
  client_id: string;
  strong_movements: string[];
  weak_movements: string[];
  disliked_exercises: string[];
  injury_history: Array<{ description: string; date: string; resolved: string }>;
  current_limitations: string | null;
  current_phase: string | null;
  current_week: number | null;
  current_1rm: Record<string, number | { value_kg?: number; result_type?: string; confidence?: string | null; updated_at?: string }>;
  current_week_summary: string | null;
  last_30d_summary: string | null;
  prev_60d_summary: string | null;
  last_12m_summary: string | null;
  best_training_days: string[];
  adherence_trend: string | null;
  movement_assessment_summary: Record<string, unknown>;
  progression_strategy: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PTClientLifestyleDoc {
  id: string;
  client_id: string;
  sleep_baseline: Record<string, unknown>;
  stress_patterns: string | null;
  schedule_notes: string | null;
  social_context: string | null;
  current_week_avg: { energy?: number; sleep?: number; stress?: number; soreness?: number };
  last_30d_avg: { energy?: number; sleep?: number; stress?: number; soreness?: number };
  prev_60d_avg: { energy?: number; sleep?: number; stress?: number; soreness?: number };
  last_12m_summary: string | null;
  recurring_challenges: string[];
  wins: Array<Record<string, unknown>>;
  goals_context: string | null;
  created_at: string;
  updated_at: string;
}

export interface PTClientRecentActivity {
  id: string;
  client_id: string;
  week_start: string | null;
  activity_type: 'message' | 'food_log' | 'workout_logged' | 'checkin' | 'metric_added' | 'goal_updated' | 'note' | 'booking';
  raw_content: string | null;
  ai_response: string | null;
  structured_data: Record<string, unknown>;
  routed_to: string[];
  routed_at: string | null;
  importance: 'critical' | 'high' | 'normal' | 'low';
  pruned: boolean;
  source_message_id: string | null;
  created_at: string;
}

export interface PTNutritionLog {
  id: string;
  client_id: string;
  logged_at: string;
  input_type: 'photo' | 'voice' | 'text';
  raw_input_url: string | null;
  raw_transcript: string | null;
  meal_description: string | null;
  food_items: Array<{ name: string; quantity: string; unit: string }>;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  calories: number | null;
  confidence: 'high' | 'medium' | 'low' | null;
  meal_type: string | null;
  notes: string | null;
  source_message_id: string | null;
  created_at: string;
}

export interface PTConversationSummary {
  id: string;
  client_id: string;
  period_start: string | null;
  period_end: string | null;
  message_count: number | null;
  summary: string | null;
  insights_extracted: Array<Record<string, unknown>>;
  applied_to_brain: boolean;
  created_at: string;
}

export type PT1RMExercise = 'BB Squat' | 'BB Deadlift' | 'BB Bench Press' | 'BB Shoulder Press' | 'Pull-up';

export interface PT1RMResult {
  id: string;
  test_id: string;
  client_id: string;
  exercise_name: PT1RMExercise | string;
  tested_weight_kg: number | null;
  tested_reps: number | null;
  estimated_1rm_kg: number | null;
  notes: string | null;
  created_at: string;
}

export interface PT1RMTest {
  id: string;
  client_id: string;
  assignment_id: string | null;
  tested_at: string;
  notes: string | null;
  created_at: string;
  results?: PT1RMResult[];
}
