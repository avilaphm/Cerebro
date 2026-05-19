import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

type MovementCategory = 'push' | 'pull' | 'hinge' | 'squat' | 'core' | 'other';

function classifyExercise(name: string): MovementCategory {
  const n = name.toLowerCase();
  if (/deadlift|rdl|romanian|good morning|hip thrust|glute bridge|kettlebell swing|swing/.test(n)) return 'hinge';
  if (/squat|leg press|lunge|split squat|step.?up|goblet|hack squat|leg extension|leg curl/.test(n)) return 'squat';
  if (/bench|push.?up|pushup|overhead press|shoulder press|tricep|chest press|\bdip\b|incline press|decline press|\bfly\b|flies|pec|lateral raise|front raise/.test(n)) return 'push';
  if (/pull.?up|pullup|chin.?up|chinup|\brow\b|rowing|lat pulldown|pulldown|cable pull|bicep|curl|face pull|shrug|rear delt|t.?bar|seated pull/.test(n)) return 'pull';
  if (/plank|crunch|sit.?up|situp|\bab\b|abs\b|core|pallof|wood chop|russian twist|bird dog|dead bug|side bend|hollow|l.?sit|v.?up/.test(n)) return 'core';
  return 'other';
}

interface WeekVolumeAccumulator {
  push_kg: number;
  pull_kg: number;
  hinge_kg: number;
  squat_kg: number;
  core_kg: number;
  other_kg: number;
  total_kg: number;
  workout_ids: Set<string>;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { client_id } = await req.json() as { client_id: string };
    if (!client_id) return json({ error: 'client_id required' }, 400);

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const now = new Date();
    const days28Ago = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
    const days30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [setLogsRes, workoutLogsRes, allTimeWorkoutsRes, nutritionLogsRes, exerciseDocRes, nutritionDocRes] =
      await Promise.all([
        adminClient
          .from('pt_set_logs')
          .select('workout_log_id, exercise_name, reps, weight, created_at')
          .eq('client_id', client_id)
          .gte('created_at', days28Ago.toISOString()),

        adminClient
          .from('pt_workout_logs')
          .select('id, completed_at, created_at')
          .eq('client_id', client_id)
          .gte('created_at', days28Ago.toISOString()),

        adminClient
          .from('pt_workout_logs')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', client_id),

        adminClient
          .from('pt_nutrition_logs')
          .select('logged_at, protein_g, carbs_g, fat_g, calories, fibre_g')
          .eq('client_id', client_id)
          .gte('logged_at', days30Ago.toISOString()),

        adminClient
          .from('pt_client_exercise_doc')
          .select('current_1rm')
          .eq('client_id', client_id)
          .single(),

        adminClient
          .from('pt_client_nutrition_doc')
          .select('daily_targets')
          .eq('client_id', client_id)
          .single(),
      ]);

    // ---- Training metrics ----

    type SetLogRow = { workout_log_id: string; exercise_name: string; reps: number | null; weight: number | null; created_at: string };
    const setLogs = (setLogsRes.data ?? []) as SetLogRow[];

    // Accumulate volume by ISO week
    const weekMap = new Map<string, WeekVolumeAccumulator>();

    for (const row of setLogs) {
      const week = isoWeek(new Date(row.created_at));
      if (!weekMap.has(week)) {
        weekMap.set(week, { push_kg: 0, pull_kg: 0, hinge_kg: 0, squat_kg: 0, core_kg: 0, other_kg: 0, total_kg: 0, workout_ids: new Set() });
      }
      const acc = weekMap.get(week)!;
      const volume = Math.round((row.reps ?? 0) * (row.weight ?? 0));
      const category = classifyExercise(row.exercise_name ?? '');
      acc[`${category}_kg`] += volume;
      acc.total_kg += volume;
      if (row.workout_log_id) acc.workout_ids.add(row.workout_log_id);
    }

    const volumeByWeek = Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, acc]) => ({
        week,
        push_kg: acc.push_kg,
        pull_kg: acc.pull_kg,
        hinge_kg: acc.hinge_kg,
        squat_kg: acc.squat_kg,
        core_kg: acc.core_kg,
        other_kg: acc.other_kg,
        total_kg: acc.total_kg,
        workout_count: acc.workout_ids.size,
      }));

    // Last 28d totals
    const totalsByCategory = volumeByWeek.reduce(
      (acc, w) => {
        acc.push_kg += w.push_kg;
        acc.pull_kg += w.pull_kg;
        acc.hinge_kg += w.hinge_kg;
        acc.squat_kg += w.squat_kg;
        acc.core_kg += w.core_kg;
        acc.other_kg += w.other_kg;
        acc.total_kg += w.total_kg;
        return acc;
      },
      { push_kg: 0, pull_kg: 0, hinge_kg: 0, squat_kg: 0, core_kg: 0, other_kg: 0, total_kg: 0 },
    );

    type WorkoutLogRow = { id: string; completed_at: string | null; created_at: string };
    const workoutLogs = (workoutLogsRes.data ?? []) as WorkoutLogRow[];
    const last28dWorkouts = workoutLogs.length;
    const avgWorkoutsPerWeek = Math.round((last28dWorkouts / 28) * 7 * 10) / 10;

    const lastWorkoutDate = workoutLogs.reduce<string | null>((latest, w) => {
      const d = w.completed_at ?? w.created_at;
      return !latest || d > latest ? d : latest;
    }, null);

    const allTimeWorkouts = allTimeWorkoutsRes.count ?? 0;

    const trainingMetrics = {
      tag: 'training_metrics',
      computed_at: now.toISOString(),
      volume_by_week: volumeByWeek,
      last_28d: {
        total_workouts: last28dWorkouts,
        avg_workouts_per_week: avgWorkoutsPerWeek,
        ...totalsByCategory,
        last_workout_date: lastWorkoutDate ? lastWorkoutDate.slice(0, 10) : null,
      },
      all_time: {
        total_workouts: allTimeWorkouts,
      },
      current_1rm: (exerciseDocRes.data?.current_1rm ?? {}) as Record<string, unknown>,
    };

    // ---- Adherence / nutrition metrics ----

    type NutritionLogRow = { logged_at: string; protein_g: number | null; carbs_g: number | null; fat_g: number | null; calories: number | null; fibre_g: number | null };
    const nutritionLogs = (nutritionLogsRes.data ?? []) as NutritionLogRow[];

    const trackingDays = new Set(nutritionLogs.map((l) => l.logged_at.slice(0, 10))).size;
    const trackingRatePct = Math.round((trackingDays / 30) * 100);

    type DailyTargets = { protein_g?: number; carbs_g?: number; fat_g?: number; calories?: number };
    const dailyTargets = (nutritionDocRes.data?.daily_targets ?? {}) as DailyTargets;

    let avgProtein = 0, avgCarbs = 0, avgFat = 0, avgCalories = 0;
    if (nutritionLogs.length > 0) {
      avgProtein = Math.round(nutritionLogs.reduce((s, l) => s + (l.protein_g ?? 0), 0) / nutritionLogs.length);
      avgCarbs = Math.round(nutritionLogs.reduce((s, l) => s + (l.carbs_g ?? 0), 0) / nutritionLogs.length);
      avgFat = Math.round(nutritionLogs.reduce((s, l) => s + (l.fat_g ?? 0), 0) / nutritionLogs.length);
      avgCalories = Math.round(nutritionLogs.reduce((s, l) => s + (l.calories ?? 0), 0) / nutritionLogs.length);
    }

    // Hit rate = % of logged days where macro was within 10% of target (below)
    const TOLERANCE = 0.10;
    let proteinHitDays = 0, calorieHitDays = 0;
    if (trackingDays > 0 && dailyTargets.protein_g) {
      const targetP = dailyTargets.protein_g;
      const targetC = dailyTargets.calories ?? 0;
      // Aggregate by day first
      const dayMap = new Map<string, { protein: number; calories: number }>();
      for (const l of nutritionLogs) {
        const day = l.logged_at.slice(0, 10);
        const existing = dayMap.get(day) ?? { protein: 0, calories: 0 };
        dayMap.set(day, {
          protein: existing.protein + (l.protein_g ?? 0),
          calories: existing.calories + (l.calories ?? 0),
        });
      }
      for (const { protein, calories } of dayMap.values()) {
        if (protein >= targetP * (1 - TOLERANCE)) proteinHitDays++;
        if (targetC > 0 && calories >= targetC * (1 - TOLERANCE) && calories <= targetC * (1 + TOLERANCE)) calorieHitDays++;
      }
    }

    const adherenceMetrics = {
      tag: 'adherence_metrics',
      computed_at: now.toISOString(),
      last_30d: {
        tracking_days: trackingDays,
        tracking_rate_pct: trackingRatePct,
        avg_protein_g: avgProtein,
        avg_carbs_g: avgCarbs,
        avg_fat_g: avgFat,
        avg_calories: avgCalories,
        target_protein_g: dailyTargets.protein_g ?? null,
        target_carbs_g: dailyTargets.carbs_g ?? null,
        target_fat_g: dailyTargets.fat_g ?? null,
        target_calories: dailyTargets.calories ?? null,
        protein_hit_rate_pct: trackingDays > 0 ? Math.round((proteinHitDays / trackingDays) * 100) : null,
        calorie_hit_rate_pct: trackingDays > 0 && dailyTargets.calories ? Math.round((calorieHitDays / trackingDays) * 100) : null,
      },
    };

    // ---- Write both docs ----

    const [exRes, nuRes] = await Promise.all([
      adminClient
        .from('pt_client_exercise_doc')
        .update({ training_metrics: trainingMetrics, updated_at: now.toISOString() })
        .eq('client_id', client_id),
      adminClient
        .from('pt_client_nutrition_doc')
        .update({ adherence_metrics: adherenceMetrics, updated_at: now.toISOString() })
        .eq('client_id', client_id),
    ]);

    if (exRes.error) console.error('training_metrics write error:', exRes.error);
    if (nuRes.error) console.error('adherence_metrics write error:', nuRes.error);

    return json({
      ok: true,
      training_metrics: trainingMetrics,
      adherence_metrics: adherenceMetrics,
    });
  } catch (err) {
    console.error('compute-client-metrics error:', err);
    return json({ error: 'Internal error.' }, 500);
  }
});
