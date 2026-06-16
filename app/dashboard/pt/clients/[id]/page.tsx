import { notFound } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { createAdminClient } from '@/utils/supabase/admin';
import type {
  PT1RMResult,
  PT1RMTest,
  PTClient,
  PTClientGoal,
  PTClientMetric,
  PTCoachingReview,
  PTCoachingTask,
  PTCheckinSession,
  PTProgramAssignment,
  PTProgramTemplate,
  PTClientNutritionDoc,
  PTPhaseNutrition,
  PTWeeklyPlan,
  PTWeeklyPlanItem,
  PTWeeklyCheckin,
} from '@/utils/pt/types';
import { safeProgramme } from '@/utils/pt/programme';
import PTClientDetail from './PTClientDetail';
import type { WeeklyNutritionLog, WeeklySetLog, WeeklyWorkoutLog } from './WeeklyClientProgress';

interface PTNote {
  id: string;
  content: string;
  is_active: boolean;
  created_at: string;
  source_message_id: string | null;
  context?: Record<string, unknown>;
}

interface PTEvent {
  id: string;
  event_type: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

export default async function PTClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  // Fetch ~31 days so the nutrition/training cards can offer a 7 / 14 / 30 day
  // range while the Sydney calendar still trims each window precisely.
  // eslint-disable-next-line react-hooks/purity
  const recentQueryStart = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();

  const loginHistoryStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [clientRes, templatesRes, assignmentsRes, eventsRes, loginEventsRes, notesRes, checkinsRes, plansRes, planItemsRes, metricsRes, goalsRes, tasksRes, reviewsRes, checkinSessionsRes, oneRmTestsRes, nutritionDocRes, phaseNutritionRes, brainReportsRes, nutritionLogsRes, workoutLogsRes, weeklySetLogsRes, priorSetLogsRes] = await Promise.all([
    supabase.from('pt_clients').select('*').eq('id', id).single(),
    supabase.from('pt_program_templates').select('*').eq('status', 'ready').order('name'),
    supabase
      .from('pt_program_assignments')
      .select('*')
      .eq('client_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('pt_events')
      .select('*')
      .eq('client_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('pt_events')
      .select('id, created_at')
      .eq('client_id', id)
      .eq('event_type', 'client_login')
      .gte('created_at', loginHistoryStart)
      .order('created_at', { ascending: false })
      .limit(60),
    supabase
      .from('pt_client_notes')
      .select('*')
      .eq('client_id', id)
      .eq('is_active', true)
      .order('created_at', { ascending: false }),
    supabase
      .from('pt_weekly_checkins')
      .select('*')
      .eq('client_id', id)
      .order('week_start', { ascending: false })
      .limit(8),
    supabase
      .from('pt_weekly_plans')
      .select('*')
      .eq('client_id', id)
      .order('week_start', { ascending: false })
      .limit(12),
    supabase
      .from('pt_weekly_plan_items')
      .select('*')
      .eq('client_id', id)
      .order('scheduled_date', { ascending: true })
      .order('sort_order', { ascending: true }),
    supabase
      .from('pt_client_metrics')
      .select('*')
      .eq('client_id', id)
      .order('measured_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(12),
    supabase
      .from('pt_client_goals')
      .select('*')
      .eq('client_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('pt_coaching_tasks')
      .select('*')
      .eq('client_id', id)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('pt_coaching_reviews')
      .select('*')
      .eq('client_id', id)
      .order('period_start', { ascending: false })
      .limit(12),
    supabase
      .from('pt_checkin_sessions')
      .select('id, client_id, week_start, status, activity_selections, ai_weekly_focus, injury_tips, stress_tips, nutrition_tips, completed_at, created_at')
      .eq('client_id', id)
      .order('week_start', { ascending: false })
      .limit(8),
    supabase
      .from('pt_client_1rm_tests')
      .select('*, results:pt_client_1rm_results(*)')
      .eq('client_id', id)
      .order('tested_at', { ascending: false })
      .limit(5),
    supabase
      .from('pt_client_nutrition_doc')
      .select('*')
      .eq('client_id', id)
      .maybeSingle(),
    supabase
      .from('pt_phase_nutrition')
      .select('*')
      .eq('client_id', id)
      .eq('review_status', 'approved')
      .order('phase_index', { ascending: true }),
    supabase
      .from('pt_client_brain_reports')
      .select('id, week_start, coach_summary, nutrition_summary, training_summary, flags')
      .eq('client_id', id)
      .order('week_start', { ascending: false })
      .limit(4),
    supabase
      .from('pt_nutrition_logs')
      .select('id, logged_at, meal_type, meal_description, food_items, protein_g, carbs_g, fat_g, fibre_g, calories, input_type')
      .eq('client_id', id)
      .gte('logged_at', recentQueryStart)
      .order('logged_at', { ascending: false }),
    supabase
      .from('pt_workout_logs')
      .select('id, completed_at, workout_title, notes, phase_index, day_index')
      .eq('client_id', id)
      .gte('completed_at', recentQueryStart)
      .order('completed_at', { ascending: false }),
    supabase
      .from('pt_set_logs')
      .select('id, workout_log_id, exercise_name, set_number, reps, weight, notes, created_at')
      .eq('client_id', id)
      .gte('created_at', recentQueryStart)
      .order('created_at', { ascending: false }),
    supabase
      .from('pt_set_logs')
      .select('exercise_name, reps, weight, created_at')
      .eq('client_id', id)
      .lt('created_at', recentQueryStart)
      .not('weight', 'is', null)
      .not('reps', 'is', null)
      .order('created_at', { ascending: false })
      .limit(5000),
  ]);

  if (clientRes.error || !clientRes.data) notFound();

  const client = clientRes.data as PTClient;
  const templates = ((templatesRes.data ?? []) as PTProgramTemplate[]).map((t) => ({
    ...t,
    programme: safeProgramme(t.programme),
  }));
  const assignments = ((assignmentsRes.data ?? []) as PTProgramAssignment[]).map((a) => ({
    ...a,
    programme: safeProgramme(a.programme),
    current_phase_index: typeof a.current_phase_index === 'number' ? a.current_phase_index : null,
    current_week: a.current_week ?? 1,
    current_block_index: a.current_block_index ?? 0,
  }));
  const events = (eventsRes.data ?? []) as PTEvent[];
  const loginEvents = (loginEventsRes.data ?? []) as Array<{ id: string; created_at: string }>;

  // Supabase keeps the authoritative last sign-in on the auth user; the in-app
  // login events only build a forward-looking history.
  let lastSignInAt: string | null = null;
  if (client.user_id) {
    try {
      const { data: authUser } = await createAdminClient().auth.admin.getUserById(client.user_id);
      lastSignInAt = authUser.user?.last_sign_in_at ?? null;
    } catch {
      lastSignInAt = null;
    }
  }

  const notes = (notesRes.data ?? []) as PTNote[];
  const weeklyCheckins = (checkinsRes.data ?? []) as PTWeeklyCheckin[];
  const weeklyPlans = (plansRes.data ?? []) as PTWeeklyPlan[];
  const weeklyPlanItems = (planItemsRes.data ?? []) as PTWeeklyPlanItem[];
  const metrics = (metricsRes.data ?? []) as PTClientMetric[];
  const goals = (goalsRes.data ?? []) as PTClientGoal[];
  const coachingTasks = (tasksRes.data ?? []) as PTCoachingTask[];
  const reviews = (reviewsRes.data ?? []) as PTCoachingReview[];
  const checkinSessions = (checkinSessionsRes.data ?? []) as PTCheckinSession[];
  const oneRmTests = ((oneRmTestsRes.data ?? []) as Array<PT1RMTest & {
    results?: Array<PT1RMResult & { load_kg?: number | null; reps?: number | null }>;
  }>).map((test) => ({
    ...test,
    results: (test.results ?? []).map((result) => {
      const row = result as PT1RMResult & { load_kg?: number | null; reps?: number | null };
      return {
        ...row,
        tested_weight_kg: row.tested_weight_kg ?? row.load_kg ?? null,
        tested_reps: row.tested_reps ?? row.reps ?? null,
      };
    }),
  })) as PT1RMTest[];
  const nutritionDoc = (nutritionDocRes.data ?? null) as PTClientNutritionDoc | null;
  const phaseNutrition = (phaseNutritionRes.data ?? []) as PTPhaseNutrition[];
  const brainReports = (brainReportsRes.data ?? []) as Array<{
    id: string;
    week_start: string;
    coach_summary: string | null;
    nutrition_summary: string | null;
    training_summary: string | null;
    flags: unknown;
  }>;
  const nutritionLogs = (nutritionLogsRes.data ?? []) as WeeklyNutritionLog[];
  const workoutLogs = (workoutLogsRes.data ?? []) as WeeklyWorkoutLog[];
  const weeklySetLogs = (weeklySetLogsRes.data ?? []) as WeeklySetLog[];
  const priorSetLogs = (priorSetLogsRes.data ?? []) as WeeklySetLog[];

  return (
    <PTClientDetail
      client={client}
      templates={templates}
      assignments={assignments}
      events={events}
      loginEvents={loginEvents}
      lastSignInAt={lastSignInAt}
      notes={notes}
      weeklyCheckins={weeklyCheckins}
      weeklyPlans={weeklyPlans}
      weeklyPlanItems={weeklyPlanItems}
      metrics={metrics}
      goals={goals}
      coachingTasks={coachingTasks}
      reviews={reviews}
      checkinSessions={checkinSessions}
      oneRmTests={oneRmTests}
      nutritionDoc={nutritionDoc}
      phaseNutrition={phaseNutrition}
      brainReports={brainReports}
      nutritionLogs={nutritionLogs}
      workoutLogs={workoutLogs}
      weeklySetLogs={weeklySetLogs}
      priorSetLogs={priorSetLogs}
    />
  );
}
