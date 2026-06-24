import { createClient } from 'npm:@supabase/supabase-js@2';
import OpenAI from 'npm:openai@4';
import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';

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

interface RequestBody {
  client_id: string;
  message_id: string;
  content: string;
}

interface KnowledgeChunk {
  chunk_text: string;
  document_title: string;
  similarity: number;
}

interface ClientBrainChunk {
  chunk_text: string;
  doc_type: string;
  similarity: number;
}

interface WorkoutLogRow {
  id: string;
  phase_index: number;
  day_index: number;
  week_number: number;
  workout_title: string;
  notes: string | null;
  completed_at: string;
  created_at: string;
}

interface SetLogRow {
  workout_log_id: string;
  exercise_name: string;
  set_number: number;
  reps: number | null;
  weight: number | null;
  notes: string | null;
  created_at: string;
}

interface NutritionLogRow {
  logged_at: string;
  meal_description: string | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  calories: number | null;
  meal_type: string | null;
}

interface MetricRow {
  measured_at: string;
  weight_kg: number | null;
  waist_cm: number | null;
  body_fat_pct: number | null;
  muscle_mass_kg: number | null;
  source: string;
  notes: string | null;
}

interface ProgrammeExercise {
  name?: string;
  sets?: string;
  reps?: string;
  rest?: string;
  notes?: string;
}

interface ProgrammeDay {
  title?: string;
  focus?: string;
  exercises?: ProgrammeExercise[];
}

interface ProgrammePhase {
  title?: string;
  focus?: string;
  weeks?: string;
  days?: ProgrammeDay[];
}

interface ProgrammeShape {
  phases?: ProgrammePhase[];
}

interface AssignmentRow {
  name: string;
  goal: string | null;
  current_phase_index: number | null;
  current_week: number | null;
  current_block_index: number | null;
  programme: ProgrammeShape | null;
}

interface LiveClientContext {
  programmeDetail: string | null;
  workoutHistory: string;
  exerciseHistory: string;
  nutritionHistory: string;
  metricsHistory: string;
  clientBrainMatches: string;
}

// Detects food-logging intent in client message
// Returns the weight in kg if explicitly stated, null if weight is mentioned but no value given, or undefined if no weight topic
function detectWeightMention(message: string): { mentioned: boolean; kg: number | null } {
  const lower = message.toLowerCase();
  // Explicit value patterns: "I'm 78kg", "down to 75 kilos", "lost 3kg", "weigh 80", "weight 79.5"
  const valuePatterns = [
    /(?:now|currently|weigh(?:ing)?|weight(?:s)?|am|i'm|i am)\s+(?:about\s+)?(\d{2,3}(?:\.\d)?)\s*(?:kg|kilos?|kgs|pounds?|lbs?)/i,
    /(\d{2,3}(?:\.\d)?)\s*(?:kg|kilos?|kgs)\b/i,
    /(?:lost|gained|dropped|put on)\s+(\d+(?:\.\d)?)\s*(?:kg|kilos?|kgs|pounds?|lbs?)/i,
  ];
  for (const pattern of valuePatterns) {
    const match = lower.match(pattern);
    if (match) {
      const raw = parseFloat(match[1]);
      // Convert lbs to kg if needed
      const isLbs = /pounds?|lbs?/.test(match[0]);
      const kg = isLbs ? Math.round(raw * 0.453592 * 10) / 10 : raw;
      if (kg > 30 && kg < 300) return { mentioned: true, kg };
    }
  }
  // Mentioned without value
  const generalPatterns = [
    /\b(lost|gained|dropped|put on|losing|gaining)\s+(?:some\s+)?weight\b/i,
    /\b(?:my\s+)?weight\s+(?:has\s+)?(?:gone|come|is\s+going)\s+(?:down|up)\b/i,
    /\bslimmer\b|\bbigger\b|\bleaner\b|\bbulk(?:ing|ed)\b/i,
  ];
  if (generalPatterns.some((p) => p.test(message))) {
    return { mentioned: true, kg: null };
  }
  return { mentioned: false, kg: null };
}

function detectFoodIntent(message: string): boolean {
  const lower = message.toLowerCase();
  const patterns = [
    /\b(just had|about to have|having|ate|eating|had .+ for (breakfast|lunch|dinner|snack))\b/,
    /\b(breakfast|lunch|dinner|snack)\s*:/,
    /\b(calories|protein|carbs|macros)\b/,
    /log (my|this) (meal|food|lunch|dinner|breakfast)/,
  ];
  return patterns.some((p) => p.test(lower));
}

async function embedText(text: string, openai: OpenAI): Promise<number[]> {
  const res = await openai.embeddings.create({ model: 'text-embedding-3-small', input: text });
  return res.data[0].embedding;
}

async function searchKnowledgeBase(
  query: string,
  openai: OpenAI,
  adminClient: ReturnType<typeof createClient>,
): Promise<string> {
  try {
    const embedding = await embedText(query, openai);
    const { data } = await adminClient.rpc('match_knowledge_chunks', {
      query_embedding: embedding,
      match_threshold: 0.35,
      match_count: 5,
    });
    if (!data || data.length === 0) return '';
    return (data as KnowledgeChunk[])
      .map((c) => `[${c.document_title}]\n${c.chunk_text}`)
      .join('\n\n---\n\n');
  } catch {
    return '';
  }
}

async function searchClientBrain(
  query: string,
  clientId: string,
  openai: OpenAI,
  adminClient: ReturnType<typeof createClient>,
): Promise<string> {
  try {
    const embedding = await embedText(query, openai);
    const { data } = await adminClient.rpc('match_client_brain_chunks', {
      query_embedding: embedding,
      target_client_id: clientId,
      match_count: 8,
      match_threshold: 0.18,
    });
    if (!data || data.length === 0) return '';
    return (data as ClientBrainChunk[])
      .map((c) => `[${c.doc_type} / ${Math.round(c.similarity * 100)}%]\n${c.chunk_text}`)
      .join('\n\n---\n\n')
      .slice(0, 7000);
  } catch {
    return '';
  }
}

function isoDate(value: string | null | undefined): string {
  if (!value) return 'unknown date';
  return value.slice(0, 10);
}

function formatKg(value: number | null | undefined): string {
  if (typeof value !== 'number') return 'bodyweight';
  return Number.isInteger(value) ? `${value}kg` : `${Math.round(value * 10) / 10}kg`;
}

function formatSet(set: SetLogRow): string {
  const reps = typeof set.reps === 'number' ? `${set.reps}` : '?';
  return `${set.set_number}:${reps}x${formatKg(set.weight)}${set.notes ? ` (${set.notes})` : ''}`;
}

function formatProgrammeDetail(assignment: AssignmentRow | null): string | null {
  if (!assignment) return null;
  const phases = assignment.programme?.phases ?? [];
  const currentPhaseIndex = assignment.current_phase_index ?? 0;
  const currentPhase = phases[currentPhaseIndex] ?? phases[0] ?? null;
  const phaseList = phases
    .map((phase, index) => `${index + 1}. ${phase.title ?? 'Untitled'}${phase.weeks ? ` (${phase.weeks}w)` : ''}`)
    .join(' -> ');

  const currentDays = (currentPhase?.days ?? [])
    .slice(0, 7)
    .map((day, dayIndex) => {
      const exercises = (day.exercises ?? [])
        .slice(0, 18)
        .map((exercise) => {
          const prescription = [exercise.sets, exercise.reps].filter(Boolean).join(' x ');
          const notes = exercise.notes ? `; notes: ${exercise.notes}` : '';
          return `${exercise.name ?? 'Exercise'}${prescription ? ` (${prescription})` : ''}${notes}`;
        })
        .join(' | ');
      return `Day ${dayIndex + 1}: ${day.title ?? 'Untitled'}${day.focus ? ` - ${day.focus}` : ''}\n${exercises}`;
    })
    .join('\n');

  return [
    `Programme: ${assignment.name}`,
    `Goal: ${assignment.goal ?? 'Not set'}`,
    `Current phase: ${currentPhase?.title ?? 'Unknown'} | week ${assignment.current_week ?? 1} | block ${assignment.current_block_index ?? 0}`,
    `All phases: ${phaseList || 'No phases found'}`,
    currentDays ? `Current phase exercise plan:\n${currentDays}` : null,
  ].filter(Boolean).join('\n');
}

function formatRecentWorkouts(workouts: WorkoutLogRow[], sets: SetLogRow[]): string {
  if (workouts.length === 0) return 'No workout logs found yet.';
  const setsByWorkout = new Map<string, SetLogRow[]>();
  for (const set of sets) {
    const list = setsByWorkout.get(set.workout_log_id) ?? [];
    list.push(set);
    setsByWorkout.set(set.workout_log_id, list);
  }

  return workouts.slice(0, 10).map((workout) => {
    const workoutSets = (setsByWorkout.get(workout.id) ?? [])
      .sort((a, b) => a.exercise_name.localeCompare(b.exercise_name) || a.set_number - b.set_number);
    const byExercise = new Map<string, SetLogRow[]>();
    for (const set of workoutSets) {
      const list = byExercise.get(set.exercise_name) ?? [];
      list.push(set);
      byExercise.set(set.exercise_name, list);
    }
    const exerciseLines = Array.from(byExercise.entries())
      .slice(0, 14)
      .map(([exercise, exerciseSets]) => `${exercise}: ${exerciseSets.map(formatSet).join(', ')}`)
      .join(' | ');
    return [
      `- ${isoDate(workout.completed_at ?? workout.created_at)}: ${workout.workout_title}`,
      `(phase ${workout.phase_index + 1}, week ${workout.week_number}, day ${workout.day_index + 1})`,
      workout.notes ? `notes: ${workout.notes}` : null,
      exerciseLines ? `sets: ${exerciseLines}` : 'sets: none logged',
    ].filter(Boolean).join(' ');
  }).join('\n');
}

function formatExerciseHistory(workouts: WorkoutLogRow[], sets: SetLogRow[]): string {
  if (sets.length === 0) return 'No set history found yet.';
  const workoutById = new Map(workouts.map((workout) => [workout.id, workout]));
  const grouped = new Map<string, SetLogRow[]>();
  for (const set of sets) {
    const key = set.exercise_name.trim();
    if (!key) continue;
    const list = grouped.get(key) ?? [];
    list.push(set);
    grouped.set(key, list);
  }

  return Array.from(grouped.entries())
    .map(([exercise, exerciseSets]) => {
      const sorted = [...exerciseSets].sort((a, b) => {
        const aTime = new Date(workoutById.get(a.workout_log_id)?.completed_at ?? a.created_at).getTime();
        const bTime = new Date(workoutById.get(b.workout_log_id)?.completed_at ?? b.created_at).getTime();
        return bTime - aTime || a.set_number - b.set_number;
      });
      const latestWorkoutId = sorted[0]?.workout_log_id;
      const latestWorkout = latestWorkoutId ? workoutById.get(latestWorkoutId) : null;
      const latestSets = sorted
        .filter((set) => set.workout_log_id === latestWorkoutId)
        .sort((a, b) => a.set_number - b.set_number);
      const sessionCount = new Set(exerciseSets.map((set) => set.workout_log_id)).size;
      const bestWeight = exerciseSets.reduce<number | null>((best, set) => (
        typeof set.weight === 'number' ? Math.max(best ?? set.weight, set.weight) : best
      ), null);
      return {
        latestTime: new Date(latestWorkout?.completed_at ?? sorted[0]?.created_at ?? 0).getTime(),
        text: `- ${exercise}: latest ${isoDate(latestWorkout?.completed_at ?? sorted[0]?.created_at)}${latestWorkout ? ` in ${latestWorkout.workout_title}` : ''}; ${latestSets.map(formatSet).join(', ')}; best logged load ${formatKg(bestWeight)}; ${sessionCount} logged session${sessionCount === 1 ? '' : 's'}`,
      };
    })
    .sort((a, b) => b.latestTime - a.latestTime)
    .slice(0, 45)
    .map((entry) => entry.text)
    .join('\n');
}

function average(values: Array<number | null>): number | null {
  const nums = values.filter((value): value is number => typeof value === 'number');
  if (nums.length === 0) return null;
  return Math.round(nums.reduce((sum, value) => sum + value, 0) / nums.length);
}

function formatNutritionHistory(logs: NutritionLogRow[]): string {
  if (logs.length === 0) return 'No nutrition logs found yet.';
  const avg = {
    protein: average(logs.map((log) => log.protein_g)),
    carbs: average(logs.map((log) => log.carbs_g)),
    fat: average(logs.map((log) => log.fat_g)),
    calories: average(logs.map((log) => log.calories)),
  };
  const recent = logs.slice(0, 14).map((log) => {
    const macros = [
      typeof log.protein_g === 'number' ? `${log.protein_g}g protein` : null,
      typeof log.carbs_g === 'number' ? `${log.carbs_g}g carbs` : null,
      typeof log.fat_g === 'number' ? `${log.fat_g}g fat` : null,
      typeof log.calories === 'number' ? `${log.calories} cals` : null,
    ].filter(Boolean).join(', ');
    return `- ${isoDate(log.logged_at)}${log.meal_type ? ` ${log.meal_type}` : ''}: ${log.meal_description ?? 'meal'}${macros ? ` (${macros})` : ''}`;
  }).join('\n');
  return [
    `Recent nutrition average from ${logs.length} logged meals: ${avg.protein ?? '?'}g protein, ${avg.carbs ?? '?'}g carbs, ${avg.fat ?? '?'}g fat, ${avg.calories ?? '?'} cals.`,
    recent,
  ].join('\n');
}

function formatMetricsHistory(metrics: MetricRow[]): string {
  if (metrics.length === 0) return 'No body metrics found yet.';
  return metrics.slice(0, 10).map((metric) => {
    const values = [
      typeof metric.weight_kg === 'number' ? `weight ${metric.weight_kg}kg` : null,
      typeof metric.waist_cm === 'number' ? `waist ${metric.waist_cm}cm` : null,
      typeof metric.body_fat_pct === 'number' ? `body fat ${metric.body_fat_pct}%` : null,
      typeof metric.muscle_mass_kg === 'number' ? `muscle ${metric.muscle_mass_kg}kg` : null,
    ].filter(Boolean).join(', ');
    return `- ${metric.measured_at}: ${values || 'metric logged'} (${metric.source})${metric.notes ? ` - ${metric.notes}` : ''}`;
  }).join('\n');
}

async function readLiveClientContext(params: {
  clientId: string;
  assignment: AssignmentRow | null;
  query: string;
  openai: OpenAI;
  adminClient: ReturnType<typeof createClient>;
}): Promise<LiveClientContext> {
  const { clientId, assignment, query, openai, adminClient } = params;
  const [workoutsRes, nutritionRes, metricsRes, clientBrainMatches] = await Promise.all([
    adminClient
      .from('pt_workout_logs')
      .select('id, phase_index, day_index, week_number, workout_title, notes, completed_at, created_at')
      .eq('client_id', clientId)
      .order('completed_at', { ascending: false })
      .limit(100),
    adminClient
      .from('pt_nutrition_logs')
      .select('logged_at, meal_description, protein_g, carbs_g, fat_g, calories, meal_type')
      .eq('client_id', clientId)
      .order('logged_at', { ascending: false })
      .limit(35),
    adminClient
      .from('pt_client_metrics')
      .select('measured_at, weight_kg, waist_cm, body_fat_pct, muscle_mass_kg, source, notes')
      .eq('client_id', clientId)
      .order('measured_at', { ascending: false })
      .limit(12),
    searchClientBrain(query, clientId, openai, adminClient),
  ]);

  const workouts = (workoutsRes.data ?? []) as WorkoutLogRow[];
  let sets: SetLogRow[] = [];
  const workoutIds = workouts.map((workout) => workout.id);
  if (workoutIds.length > 0) {
    const { data: setRows } = await adminClient
      .from('pt_set_logs')
      .select('workout_log_id, exercise_name, set_number, reps, weight, notes, created_at')
      .eq('client_id', clientId)
      .in('workout_log_id', workoutIds)
      .order('created_at', { ascending: false })
      .limit(2000);
    sets = (setRows ?? []) as SetLogRow[];
  }

  return {
    programmeDetail: formatProgrammeDetail(assignment),
    workoutHistory: formatRecentWorkouts(workouts, sets),
    exerciseHistory: formatExerciseHistory(workouts, sets),
    nutritionHistory: formatNutritionHistory((nutritionRes.data ?? []) as NutritionLogRow[]),
    metricsHistory: formatMetricsHistory((metricsRes.data ?? []) as MetricRow[]),
    clientBrainMatches,
  };
}

interface BrainContext {
  lastSessionSummary: string | null;
  summary12m: string | null;
  openLoops: string[];
  milestones: string[];
  keyPhrases: string[];
  coachingReasoning: Record<string, unknown>;
  importantDecisions: Array<Record<string, unknown>>;
  nutritionProfile: {
    currentWeekAvg: Record<string, number>;
    favouriteFoods: string[];
    obstacles: string | null;
    recentWins: string[];
    phaseNutritionStrategy: Record<string, unknown>;
  };
  exerciseProfile: {
    current1rm: Record<string, unknown>;
    currentPhase: string | null;
    injuryHistory: Array<{ description: string; resolved: string }>;
    strongMovements: string[];
    weakMovements: string[];
    currentLimitations: string | null;
    last30dSummary: string | null;
    movementAssessmentSummary: Record<string, unknown>;
    progressionStrategy: Record<string, unknown>;
  };
  lifestyleProfile: {
    recurringChallenges: string[];
    last30dAvg: Record<string, number>;
    goalsContext: string | null;
  };
}

async function readBrainDocs(
  clientId: string,
  adminClient: ReturnType<typeof createClient>,
): Promise<BrainContext | null> {
  const [brainRes, nutritionRes, exerciseRes, lifestyleRes] = await Promise.all([
    adminClient
      .from('pt_client_brain')
      .select('last_session_summary, summary_12m, open_loops, milestones, key_phrases, coaching_reasoning, important_decisions')
      .eq('client_id', clientId)
      .single(),
    adminClient
      .from('pt_client_nutrition_doc')
      .select('current_week_avg, favourite_foods, nutrition_obstacles, recent_wins, phase_nutrition_strategy')
      .eq('client_id', clientId)
      .single(),
    adminClient
      .from('pt_client_exercise_doc')
      .select('current_1rm, current_phase, injury_history, strong_movements, weak_movements, current_limitations, last_30d_summary, movement_assessment_summary, progression_strategy')
      .eq('client_id', clientId)
      .single(),
    adminClient
      .from('pt_client_lifestyle_doc')
      .select('recurring_challenges, last_30d_avg, goals_context')
      .eq('client_id', clientId)
      .single(),
  ]);

  if (!brainRes.data) return null;

  return {
    lastSessionSummary: (brainRes.data.last_session_summary as string | null),
    summary12m: (brainRes.data.summary_12m as string | null),
    openLoops: (brainRes.data.open_loops as string[]) ?? [],
    milestones: ((brainRes.data.milestones as string[]) ?? []).slice(-5),
    keyPhrases: ((brainRes.data.key_phrases as string[]) ?? []).slice(-10),
    coachingReasoning: (brainRes.data.coaching_reasoning as Record<string, unknown>) ?? {},
    importantDecisions: ((brainRes.data.important_decisions as Array<Record<string, unknown>>) ?? []).slice(-8),
    nutritionProfile: {
      currentWeekAvg: (nutritionRes.data?.current_week_avg as Record<string, number>) ?? {},
      favouriteFoods: ((nutritionRes.data?.favourite_foods as string[]) ?? []).slice(-10),
      obstacles: (nutritionRes.data?.nutrition_obstacles as string | null),
      recentWins: ((nutritionRes.data?.recent_wins as string[]) ?? []).slice(-5),
      phaseNutritionStrategy: (nutritionRes.data?.phase_nutrition_strategy as Record<string, unknown>) ?? {},
    },
    exerciseProfile: {
      current1rm: (exerciseRes.data?.current_1rm as Record<string, unknown>) ?? {},
      currentPhase: (exerciseRes.data?.current_phase as string | null),
      injuryHistory: ((exerciseRes.data?.injury_history as Array<{ description: string; resolved: string }>) ?? []).filter((i) => i.resolved !== 'true'),
      strongMovements: ((exerciseRes.data?.strong_movements as string[]) ?? []).slice(-8),
      weakMovements: ((exerciseRes.data?.weak_movements as string[]) ?? []).slice(-8),
      currentLimitations: (exerciseRes.data?.current_limitations as string | null),
      last30dSummary: (exerciseRes.data?.last_30d_summary as string | null),
      movementAssessmentSummary: (exerciseRes.data?.movement_assessment_summary as Record<string, unknown>) ?? {},
      progressionStrategy: (exerciseRes.data?.progression_strategy as Record<string, unknown>) ?? {},
    },
    lifestyleProfile: {
      recurringChallenges: ((lifestyleRes.data?.recurring_challenges as string[]) ?? []).slice(-8),
      last30dAvg: (lifestyleRes.data?.last_30d_avg as Record<string, number>) ?? {},
      goalsContext: (lifestyleRes.data?.goals_context as string | null),
    },
  };
}

function compactJson(value: unknown, maxLength = 900): string | null {
  if (!value || typeof value !== 'object') return null;
  const objectValue = value as Record<string, unknown>;
  if (Object.keys(objectValue).length === 0) return null;
  return JSON.stringify(objectValue).slice(0, maxLength);
}

function formatBrainContext(brain: BrainContext): string {
  const lines: string[] = ['## Long-Term Client Memory'];

  if (brain.summary12m) {
    lines.push(`**12-month overview:** ${brain.summary12m}`);
  }
  if (brain.lastSessionSummary) {
    lines.push(`**Last interaction:** ${brain.lastSessionSummary}`);
  }
  if (brain.openLoops.length > 0) {
    lines.push(`**Follow-up items:** ${brain.openLoops.slice(-3).join('; ')}`);
  }
  if (brain.milestones.length > 0) {
    lines.push(`**Recent milestones:** ${brain.milestones.join('; ')}`);
  }
  if (brain.keyPhrases.length > 0) {
    lines.push(`**What they've said:** "${brain.keyPhrases.slice(-3).join('" / "')}"`);
  }
  const coachingReasoning = compactJson(brain.coachingReasoning);
  if (coachingReasoning) lines.push(`**Coach reasoning:** ${coachingReasoning}`);
  if (brain.importantDecisions.length > 0) {
    lines.push(`**Important coaching decisions:** ${JSON.stringify(brain.importantDecisions).slice(0, 900)}`);
  }

  const { exerciseProfile: ex, nutritionProfile: nu, lifestyleProfile: ls } = brain;

  if (Object.keys(ex.current1rm).length > 0) {
    const rms = Object.entries(ex.current1rm).map(([k, v]) => {
      if (typeof v === 'number') return `${k}: ${v}kg`;
      if (v && typeof v === 'object' && 'value_kg' in v) return `${k}: ${(v as { value_kg?: number }).value_kg}kg`;
      return `${k}: ${JSON.stringify(v)}`;
    }).join(', ');
    lines.push(`**Current 1RMs:** ${rms}`);
  }
  const movementAssessment = compactJson(ex.movementAssessmentSummary);
  if (movementAssessment) lines.push(`**Movement assessment:** ${movementAssessment}`);
  const progressionStrategy = compactJson(ex.progressionStrategy);
  if (progressionStrategy) lines.push(`**Progression strategy:** ${progressionStrategy}`);
  if (ex.currentLimitations) lines.push(`**Active injury/limitation:** ${ex.currentLimitations}`);
  if (ex.injuryHistory.length > 0) {
    lines.push(`**Injury history:** ${ex.injuryHistory.map((i) => i.description).join('; ')}`);
  }
  if (ex.strongMovements.length > 0) lines.push(`**Strong at:** ${ex.strongMovements.join(', ')}`);
  if (ex.weakMovements.length > 0) lines.push(`**Needs work:** ${ex.weakMovements.join(', ')}`);
  if (ex.last30dSummary) lines.push(`**Last 30 days training:** ${ex.last30dSummary}`);

  if (Object.keys(nu.currentWeekAvg).length > 0) {
    const avg = nu.currentWeekAvg;
    lines.push(`**Nutrition this week (avg):** ${avg.protein_g ?? '?'}g protein, ${avg.carbs_g ?? '?'}g carbs, ${avg.fat_g ?? '?'}g fat, ${avg.calories ?? '?'} cals`);
  }
  if (nu.obstacles) lines.push(`**Nutrition challenge:** ${nu.obstacles}`);
  if (nu.favouriteFoods.length > 0) lines.push(`**Favourite foods:** ${nu.favouriteFoods.join(', ')}`);
  const phaseNutrition = compactJson(nu.phaseNutritionStrategy);
  if (phaseNutrition) lines.push(`**Phase nutrition strategy:** ${phaseNutrition}`);

  if (ls.recurringChallenges.length > 0) {
    lines.push(`**Life challenges:** ${ls.recurringChallenges.join('; ')}`);
  }
  if (ls.goalsContext) lines.push(`**Deeper goal context:** ${ls.goalsContext}`);

  return lines.join('\n');
}

function extractTextFromBlocks(blocks: unknown[]): string {
  return blocks
    .map((block) => {
      const row = block && typeof block === 'object' && !Array.isArray(block) ? block as Record<string, unknown> : {};
      return row.type === 'text' && typeof row.text === 'string' ? row.text : '';
    })
    .join('\n')
    .trim();
}

function buildSystemPrompt(params: {
  clientName: string;
  goals: string | null;
  coachingFocus: string | null;
  lifestyleContext: string | null;
  activeGoals: Array<{ title: string; target: string | null; status: string }>;
  recentCheckins: Array<{ week_start: string; ai_weekly_focus: unknown }>;
  clientNotes: Array<{ content: string; created_at: string }>;
  knowledgeContext: string;
  brainContext: string | null;
  liveContext: LiveClientContext;
}): string {
  const {
    clientName, goals, coachingFocus, lifestyleContext,
    activeGoals, recentCheckins, clientNotes, knowledgeContext, brainContext, liveContext,
  } = params;

  const goalsText = activeGoals.length > 0
    ? activeGoals.map((g) => `- ${g.title}${g.target ? ` (target: ${g.target})` : ''}`).join('\n')
    : (goals ?? 'Not specified');

  const checkinsText = recentCheckins.length > 0
    ? recentCheckins
        .slice(0, 2)
        .map((c) => {
          const focus = c.ai_weekly_focus as { exercise?: string; nutrition?: string; sleep?: string } | null;
          return `Week of ${c.week_start}: ${focus ? `exercise: ${focus.exercise ?? ''}, nutrition: ${focus.nutrition ?? ''}, sleep: ${focus.sleep ?? ''}` : 'check-in completed'}`;
        })
        .join('\n')
    : 'No recent check-ins';

  const notesText = clientNotes.length > 0
    ? clientNotes.map((n) => `- ${n.content}`).join('\n')
    : 'No coaching notes';

  return `Your name is Henrique. You are Pedro Avila's AI coaching assistant -- the client's personal virtual trainer inside the Cerebro coaching app.

Pedro is a Brazilian-born, Sydney-based personal trainer and AI founder. You embody Pedro's coaching philosophy: evidence-based programming, progressive overload, and holistic health habits.

## Your role
- You are the client's always-available AI coach. You know everything about them.
- Answer questions about their programme, exercises, nutrition, recovery, and lifestyle.
- Give specific, actionable advice grounded in their current programme and live history.
- You are warm, direct, and encouraging -- not robotic or overly formal.
- Keep responses concise and practical unless asked for detail.
- When you reference past events, weights, reps, sets, meals, body metrics, or conversations, use the exact client evidence below and mention dates/exercises naturally.
- If the client asks why you are called Henrique, explain: Pedro's full first name is Pedro Henrique, and Henrique is his second first name. The name fits because you are the second version of Pedro inside the app.

## Evidence hierarchy
1. For questions about what this client has done, use Live Client Context first. That is the source of truth.
2. Use Long-Term Client Memory for patterns, goals, injuries, preferences, and coaching decisions.
3. Use Pedro's Knowledge Base for training/nutrition principles.
4. Use web search only when the client asks a general/current question that cannot be answered from the client evidence or Pedro's knowledge base.
5. Never use web search to guess the client's own history. If a client-specific detail is not present, say what you can see and ask for the missing detail.

## Client: ${clientName}
**Goals:** ${goalsText}
**Coaching focus:** ${coachingFocus ?? 'General fitness'}
**Lifestyle context:** ${lifestyleContext ?? 'Not specified'}

## Live Client Context
### Active Programme
${liveContext.programmeDetail ?? 'No active programme assigned yet.'}

### Recent Exact Workouts And Set Logs
${liveContext.workoutHistory}

### Exercise-Level History Summary
${liveContext.exerciseHistory}

### Nutrition Logs
${liveContext.nutritionHistory}

### Body Metrics
${liveContext.metricsHistory}

## Recent Check-ins
${checkinsText}

## Pedro's Coaching Notes
${notesText}

${brainContext ? `${brainContext}\n` : ''}${liveContext.clientBrainMatches ? `## Client Brain Semantic Matches\n${liveContext.clientBrainMatches}\n` : ''}${knowledgeContext ? `## Pedro's Knowledge Base (relevant excerpts)\n${knowledgeContext}\n` : ''}
## Nutrition Logging
If the client is describing food they ate or are about to eat (e.g. "just had X", "about to have X", "had X for lunch"), acknowledge that you'll log it and confirm: "[meal description] -- looks like ~Xg protein, Xg carbs, Xg fat (~X cals). Logged." Then ask a brief follow-up if useful.

## Important rules
- If the client asks what they did previously for an exercise, answer from Recent Exact Workouts And Set Logs or Exercise-Level History Summary. Include the latest date, exercise name, sets, reps, and load when available.
- If the client asks what to lift today, compare today's active programme prescription with their latest logged performance and any 1RM targets in the programme notes.
- If the client mentions "hey pedro", "hi pedro", or explicitly asks to speak to Pedro directly, always reply: "I'll flag this for Pedro so he can follow up with you directly. In the meantime, [brief helpful note]."
- Never pretend to be Pedro himself -- you are Henrique, his AI assistant.
- If you don't know something specific about the client after checking the evidence, say exactly what you can and cannot see.
- For medical concerns or injuries, always recommend the client consult a healthcare professional.
- If the client mentions losing or gaining weight but does NOT state a specific number, ask: "That's great progress! What's your current weight so I can update your profile?"
- If the client mentions a specific weight (e.g. "I'm now 78kg"), acknowledge it positively and confirm it has been noted for their progress record.
- Respond in plain conversational text. No markdown headers. Keep it chat-like.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization.' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY')!;
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceKey);
    const openai = new OpenAI({ apiKey: openaiKey });
    const anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: 'Unauthorized.' }, 401);

    const body = (await req.json()) as RequestBody;
    if (!body.client_id || !body.message_id || !body.content) {
      return json({ error: 'Missing required fields.' }, 400);
    }

    // Verify client belongs to this user
    const { data: clientRow } = await adminClient
      .from('pt_clients')
      .select('id, name, goals, coaching_focus, lifestyle_context, use_brain')
      .eq('id', body.client_id)
      .eq('user_id', authData.user.id)
      .single();

    if (!clientRow) return json({ error: 'Client not found.' }, 404);

    const client = clientRow as {
      id: string; name: string; goals: string | null;
      coaching_focus: string | null; lifestyle_context: string | null;
      use_brain: boolean;
    };

    const wantsPedro = /\b(hey|hi|hello)\s+pedro\b/i.test(body.content);
    const hasFoodIntent = detectFoodIntent(body.content);
    const weightSignal = detectWeightMention(body.content);

    // Fetch all context in parallel
    const [
      goalsRes,
      assignmentRes,
      checkinsRes,
      notesRes,
      historyRes,
      knowledgeContext,
      brainDocs,
    ] = await Promise.all([
      adminClient
        .from('pt_client_goals')
        .select('title, target, status')
        .eq('client_id', body.client_id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(6),
      adminClient
        .from('pt_program_assignments')
        .select('name, goal, current_phase_index, current_week, current_block_index, programme')
        .eq('client_id', body.client_id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1),
      adminClient
        .from('pt_weekly_checkins')
        .select('week_start, ai_weekly_focus')
        .eq('client_id', body.client_id)
        .order('week_start', { ascending: false })
        .limit(3),
      adminClient
        .from('pt_client_notes')
        .select('content, created_at')
        .eq('client_id', body.client_id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(6),
      adminClient
        .from('pt_messages')
        .select('sender, content, created_at')
        .eq('client_id', body.client_id)
        .order('created_at', { ascending: false })
        .limit(30),
      searchKnowledgeBase(body.content, openai, adminClient),
      client.use_brain ? readBrainDocs(body.client_id, adminClient) : Promise.resolve(null),
    ]);

    const activeAssignment = ((assignmentRes.data ?? [])[0] ?? null) as AssignmentRow | null;
    const liveContext = await readLiveClientContext({
      clientId: body.client_id,
      assignment: activeAssignment,
      query: body.content,
      openai,
      adminClient,
    });

    // If food intent detected and brain is on, call log-nutrition in parallel with chat
    let nutritionResult: { meal_description: string; protein_g: number | null; carbs_g: number | null; fat_g: number | null; calories: number | null } | null = null;
    if (hasFoodIntent && client.use_brain) {
      try {
        const logRes = await fetch(`${supabaseUrl}/functions/v1/log-nutrition`, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            client_id: body.client_id,
            input_type: 'text',
            content: body.content,
            source_message_id: body.message_id,
          }),
        });
        if (logRes.ok) {
          const logData = await logRes.json() as { ok: boolean; nutrition?: typeof nutritionResult };
          if (logData.ok && logData.nutrition) {
            nutritionResult = logData.nutrition;
          }
        }
      } catch {
        // Non-blocking -- proceed without nutrition data
      }
    }

    const history = ((historyRes.data ?? []) as Array<{ sender: string; content: string; created_at: string }>)
      .reverse()
      .filter((m) => m.content !== body.content)
      .slice(-20);

    const brainContext = brainDocs ? formatBrainContext(brainDocs) : null;

    const systemPrompt = buildSystemPrompt({
      clientName: client.name,
      goals: client.goals,
      coachingFocus: client.coaching_focus,
      lifestyleContext: client.lifestyle_context,
      activeGoals: (goalsRes.data ?? []) as Array<{ title: string; target: string | null; status: string }>,
      recentCheckins: (checkinsRes.data ?? []) as Array<{ week_start: string; ai_weekly_focus: unknown }>,
      clientNotes: (notesRes.data ?? []) as Array<{ content: string; created_at: string }>,
      knowledgeContext,
      brainContext,
      liveContext,
    });

    // Inject nutrition context into the user message if food was logged
    let userContent = body.content;
    if (nutritionResult) {
      userContent = `${body.content}\n\n[System: nutrition logged -- ${nutritionResult.meal_description}, ~${nutritionResult.protein_g ?? '?'}g protein, ~${nutritionResult.carbs_g ?? '?'}g carbs, ~${nutritionResult.fat_g ?? '?'}g fat, ~${nutritionResult.calories ?? '?'} cals]`;
    }

    const chatMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((m): OpenAI.Chat.ChatCompletionMessageParam => ({
        role: m.sender === 'client' ? 'user' : 'assistant',
        content: m.content,
      })),
      { role: 'user', content: userContent },
    ];

    let aiResponse = "I'm here to help -- could you rephrase that?";
    if (anthropic) {
      const claudeMessages = chatMessages
        .filter((message) => message.role !== 'system')
        .map((message) => ({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
        }));
      const response = await anthropic.messages.create(
        {
          model: 'claude-sonnet-4-6',
          temperature: 0.4,
          max_tokens: 900,
          system: systemPrompt,
          tools: [
            {
              type: 'web_search_20250305',
              name: 'web_search',
              max_uses: 2,
            },
          ],
          messages: claudeMessages,
        } as any,
      );
      aiResponse = extractTextFromBlocks(response.content as unknown[]) || aiResponse;
    } else {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        temperature: 0.5,
        max_tokens: 700,
        messages: chatMessages,
      });
      aiResponse = completion.choices[0]?.message?.content?.trim() ?? aiResponse;
    }

    if (wantsPedro) {
      await Promise.all([
        adminClient
          .from('pt_messages')
          .update({ ai_handoff_requested: true })
          .eq('id', body.message_id),
        adminClient
          .from('pt_coaching_tasks')
          .insert({
            client_id: body.client_id,
            title: `${client.name} wants to speak with you directly`,
            details: `Client message: "${body.content}"`,
            status: 'open',
            priority: 'high',
          }),
      ]);
    }

    const { error: insertError } = await adminClient
      .from('pt_messages')
      .insert({
        client_id: body.client_id,
        sender: 'ai',
        content: aiResponse,
      });

    if (insertError) {
      console.error('ai-client-chat insert error:', insertError);
      return json({ error: 'Failed to save AI response.' }, 500);
    }

    // If a specific weight was mentioned, log it to pt_client_metrics and notify Pedro
    if (weightSignal.mentioned && weightSignal.kg !== null) {
      const today = new Date().toISOString().split('T')[0];
      adminClient.from('pt_client_metrics').insert({
        client_id: body.client_id,
        measured_at: today,
        weight_kg: weightSignal.kg,
        source: 'chat',
        notes: `Auto-captured from chat: "${body.content.slice(0, 120)}"`,
      }).then(() => {
        return adminClient.from('pt_coaching_tasks').insert({
          client_id: body.client_id,
          source_type: 'weight_update',
          title: `${client.name} weight update: ${weightSignal.kg}kg`,
          details: `Captured from chat message: "${body.content.slice(0, 200)}"`,
          status: 'open',
          priority: 'normal',
        });
      }).catch(() => { /* non-blocking */ });
    }

    // Fire-and-forget: update client brain async (do not await)
    fetch(`${supabaseUrl}/functions/v1/update-client-brain`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: body.client_id,
        trigger_type: 'message',
        content: body.content,
        ai_response: aiResponse,
        source_message_id: body.message_id,
      }),
    }).catch(() => {
      // Non-blocking -- brain update failure never surfaces to the client
    });

    return json({ ok: true, response: aiResponse, handoff_requested: wantsPedro, nutrition_logged: !!nutritionResult });
  } catch (err) {
    console.error('ai-client-chat error:', err);
    return json({ error: 'Internal error.' }, 500);
  }
});
