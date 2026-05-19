import { createClient } from 'npm:@supabase/supabase-js@2';
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

function jwtPayload(jwt: string): Record<string, unknown> {
  try {
    return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
  }
}

type TriggerType =
  | 'message'
  | 'food_log'
  | 'workout_logged'
  | 'client_document_analysis'
  | 'program_generation'
  | 'phase_nutrition'
  | 'coach_decision'
  | '1rm_result'
  | 'checkin'
  | 'metric_added'
  | 'goal_updated'
  | 'note'
  | 'booking';

interface RequestBody {
  client_id: string;
  trigger_type: TriggerType;
  content: string;
  ai_response?: string;
  structured_data?: Record<string, unknown>;
  source_message_id?: string;
}

interface BrainExtraction {
  master_updates: {
    key_phrase?: string;
    open_loop?: string;
    milestone?: string;
    personality_note?: string;
    last_session_summary: string;
  } | null;
  nutrition_updates: {
    observation?: string;
    food_preference?: string;
    obstacle?: string;
    win?: string;
  } | null;
  exercise_updates: {
    observation?: string;
    injury?: string;
    strong_movement?: string;
    weak_movement?: string;
    pr?: string;
  } | null;
  lifestyle_updates: {
    observation?: string;
    challenge?: string;
    win?: string;
  } | null;
}

interface StructuredBrainData {
  intake_summary?: Record<string, unknown>;
  movement_assessment_summary?: Record<string, unknown>;
  coaching_reasoning?: Record<string, unknown>;
  movement_priorities?: string[];
  injury_precautions?: string[];
  progression_strategy?: Record<string, unknown>;
  nutrition_priorities?: Record<string, unknown>;
  phase_nutrition_strategy?: Record<string, unknown>;
  phase_title?: string;
  phase_type?: string;
  training_context?: Record<string, unknown>;
  recommendations?: Record<string, unknown>;
  important_decision?: string | Record<string, unknown>;
  important_decisions?: Array<string | Record<string, unknown>>;
  current_phase?: string;
  current_week?: number;
  current_limitations?: string;
  strong_movements?: string[];
  weak_movements?: string[];
  injury_history?: Array<Record<string, unknown>>;
  one_rm_results?: Array<{
    exercise_name?: string;
    estimated_1rm_kg?: number;
    load_kg?: number;
    result_type?: string;
    confidence?: string;
  }>;
}

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

function asTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function uniqueTail(values: string[], limit: number): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(-limit);
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (item === null || item === undefined) return false;
      if (typeof item === 'string') return item.trim().length > 0;
      if (Array.isArray(item)) return item.length > 0;
      if (typeof item === 'object') return Object.keys(item as Record<string, unknown>).length > 0;
      return true;
    }),
  );
}

function appendDecision(
  current: unknown,
  decision: string | Record<string, unknown>,
  triggerType: TriggerType,
): Array<Record<string, unknown>> {
  const existing = Array.isArray(current) ? current : [];
  const normalized = typeof decision === 'string'
    ? { decision }
    : decision;
  return [
    ...existing,
    {
      ...normalized,
      trigger_type: triggerType,
      recorded_at: new Date().toISOString(),
    },
  ].slice(-100);
}

async function applyStructuredBrainUpdates(
  clientId: string,
  triggerType: TriggerType,
  rawData: Record<string, unknown> | undefined,
  adminClient: ReturnType<typeof createClient>,
): Promise<boolean> {
  const data = (rawData ?? {}) as StructuredBrainData;
  const updates: Promise<unknown>[] = [];
  const now = new Date().toISOString();
  let changed = false;

  const decisionInputs = [
    ...(Array.isArray(data.important_decisions) ? data.important_decisions : []),
    ...(data.important_decision ? [data.important_decision] : []),
  ];

  if (data.coaching_reasoning || data.intake_summary || data.movement_priorities || data.injury_precautions || decisionInputs.length > 0) {
    const { data: brain } = await adminClient
      .from('pt_client_brain')
      .select('coaching_reasoning, important_decisions, total_interactions')
      .eq('client_id', clientId)
      .single();

    const coachingReasoning = {
      ...((brain?.coaching_reasoning as Record<string, unknown>) ?? {}),
      ...compactObject({
        intake_summary: data.intake_summary,
        reasoning: data.coaching_reasoning,
        movement_priorities: data.movement_priorities,
        injury_precautions: data.injury_precautions,
        last_structured_update: {
          trigger_type: triggerType,
          updated_at: now,
        },
      }),
    };

    let decisions = (brain?.important_decisions as Array<Record<string, unknown>>) ?? [];
    for (const decision of decisionInputs) {
      decisions = appendDecision(decisions, decision, triggerType);
    }

    updates.push(
      adminClient
        .from('pt_client_brain')
        .update({
          coaching_reasoning: coachingReasoning,
          important_decisions: decisions,
          total_interactions: ((brain?.total_interactions as number) ?? 0) + 1,
          updated_at: now,
        })
        .eq('client_id', clientId),
    );
    changed = true;
  }

  if (
    data.movement_assessment_summary ||
    data.progression_strategy ||
    data.current_phase ||
    data.current_week ||
    data.current_limitations ||
    data.strong_movements ||
    data.weak_movements ||
    data.injury_history ||
    data.one_rm_results
  ) {
    const { data: exerciseDoc } = await adminClient
      .from('pt_client_exercise_doc')
      .select('movement_assessment_summary, progression_strategy, strong_movements, weak_movements, injury_history, current_1rm, current_phase, current_week, current_limitations')
      .eq('client_id', clientId)
      .single();

    const current1rm = { ...((exerciseDoc?.current_1rm as Record<string, unknown>) ?? {}) };
    for (const result of data.one_rm_results ?? []) {
      if (!result.exercise_name) continue;
      const value = result.estimated_1rm_kg ?? result.load_kg;
      if (typeof value !== 'number') continue;
      current1rm[result.exercise_name] = {
        value_kg: value,
        result_type: result.result_type ?? 'unknown',
        confidence: result.confidence ?? null,
        updated_at: now,
      };
    }

    updates.push(
      adminClient
        .from('pt_client_exercise_doc')
        .update({
          movement_assessment_summary: {
            ...((exerciseDoc?.movement_assessment_summary as Record<string, unknown>) ?? {}),
            ...(data.movement_assessment_summary ?? {}),
          },
          progression_strategy: {
            ...((exerciseDoc?.progression_strategy as Record<string, unknown>) ?? {}),
            ...(data.progression_strategy ?? {}),
          },
          strong_movements: uniqueTail([
            ...asTextArray(exerciseDoc?.strong_movements),
            ...asTextArray(data.strong_movements),
          ], 40),
          weak_movements: uniqueTail([
            ...asTextArray(exerciseDoc?.weak_movements),
            ...asTextArray(data.weak_movements),
          ], 40),
          injury_history: [
            ...((Array.isArray(exerciseDoc?.injury_history) ? exerciseDoc?.injury_history : []) as Array<Record<string, unknown>>),
            ...(data.injury_history ?? []),
          ].slice(-30),
          current_1rm: current1rm,
          current_phase: data.current_phase ?? exerciseDoc?.current_phase ?? null,
          current_week: data.current_week ?? exerciseDoc?.current_week ?? null,
          current_limitations: data.current_limitations ?? exerciseDoc?.current_limitations ?? null,
          updated_at: now,
        })
        .eq('client_id', clientId),
    );
    changed = true;
  }

  if (data.nutrition_priorities || data.phase_nutrition_strategy || data.training_context || data.recommendations) {
    const { data: nutritionDoc } = await adminClient
      .from('pt_client_nutrition_doc')
      .select('phase_nutrition_strategy, eating_habits')
      .eq('client_id', clientId)
      .single();

    const phaseStrategy = { ...((nutritionDoc?.phase_nutrition_strategy as Record<string, unknown>) ?? {}) };
    if (data.phase_nutrition_strategy || data.training_context || data.recommendations) {
      const phaseKey = data.phase_title || data.phase_type || 'general';
      phaseStrategy[phaseKey] = compactObject({
        phase_title: data.phase_title,
        phase_type: data.phase_type,
        training_context: data.training_context,
        recommendations: data.recommendations,
        strategy: data.phase_nutrition_strategy,
        updated_at: now,
      });
    }

    updates.push(
      adminClient
        .from('pt_client_nutrition_doc')
        .update({
          phase_nutrition_strategy: phaseStrategy,
          eating_habits: compactObject({
            ...((nutritionDoc?.eating_habits as Record<string, unknown>) ?? {}),
            nutrition_priorities: data.nutrition_priorities,
          }),
          updated_at: now,
        })
        .eq('client_id', clientId),
    );
    changed = true;
  }

  if (updates.length > 0) await Promise.allSettled(updates);
  return changed;
}

async function extractInsights(
  content: string,
  triggerType: TriggerType,
  aiResponse: string | undefined,
  currentBrain: { last_session_summary: string | null; personality_notes: Record<string, unknown> },
  anthropic: Anthropic,
): Promise<BrainExtraction> {
  const prompt = `You are a coaching AI that extracts key insights from client interactions to build a long-term client profile.

New interaction:
Type: ${triggerType}
Content: "${content}"${aiResponse ? `\nAI response: "${aiResponse}"` : ''}

Current client summary: ${currentBrain.last_session_summary ?? 'No previous summary.'}

Extract ONLY significant insights worth remembering long-term. Most messages have nothing worth extracting.
Focus on: injuries/limitations, strong preferences or dislikes, notable achievements, life context affecting training, personality patterns.

Return ONLY valid JSON with this structure (null for sections with nothing significant):
{
  "master_updates": {
    "key_phrase": "verbatim quote if they said something revealing about themselves, else omit",
    "open_loop": "something they mentioned needing follow-up on, else omit",
    "milestone": "notable achievement to celebrate, else omit",
    "personality_note": "new personality/communication insight, else omit",
    "last_session_summary": "2-sentence summary of this interaction"
  } or null,
  "nutrition_updates": {
    "observation": "new pattern noticed, else omit",
    "food_preference": "strong like/dislike mentioned, else omit",
    "obstacle": "barrier to good nutrition mentioned, else omit",
    "win": "nutrition achievement, else omit"
  } or null,
  "exercise_updates": {
    "observation": "training pattern noted, else omit",
    "injury": "injury or limitation mentioned, else omit",
    "strong_movement": "exercise they excel at, else omit",
    "weak_movement": "movement they struggle with, else omit",
    "pr": "personal record achieved, else omit"
  } or null,
  "lifestyle_updates": {
    "observation": "lifestyle pattern noted, else omit",
    "challenge": "recurring life challenge mentioned, else omit",
    "win": "lifestyle improvement, else omit"
  } or null
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { master_updates: null, nutrition_updates: null, exercise_updates: null, lifestyle_updates: null };
    return JSON.parse(jsonMatch[0]) as BrainExtraction;
  } catch {
    return { master_updates: null, nutrition_updates: null, exercise_updates: null, lifestyle_updates: null };
  }
}

async function applyBrainUpdates(
  clientId: string,
  extraction: BrainExtraction,
  adminClient: ReturnType<typeof createClient>,
): Promise<void> {
  const updates: Promise<unknown>[] = [];

  if (extraction.master_updates) {
    const m = extraction.master_updates;
    const { data: brain } = await adminClient
      .from('pt_client_brain')
      .select('key_phrases, open_loops, milestones, personality_notes, total_interactions')
      .eq('client_id', clientId)
      .single();

    if (brain) {
      const keyPhrases = (brain.key_phrases as string[]) ?? [];
      const openLoops = (brain.open_loops as string[]) ?? [];
      const milestones = (brain.milestones as string[]) ?? [];
      const personalityNotes = (brain.personality_notes as Record<string, string>) ?? {};

      if (m.key_phrase) keyPhrases.push(m.key_phrase);
      if (m.open_loop) openLoops.push(m.open_loop);
      if (m.milestone) milestones.push(`${new Date().toISOString().split('T')[0]}: ${m.milestone}`);
      if (m.personality_note) {
        const key = `note_${Date.now()}`;
        personalityNotes[key] = m.personality_note;
      }

      updates.push(
        adminClient
          .from('pt_client_brain')
          .update({
            key_phrases: keyPhrases.slice(-50),
            open_loops: openLoops.slice(-20),
            milestones: milestones.slice(-100),
            personality_notes: personalityNotes,
            last_session_summary: m.last_session_summary,
            total_interactions: ((brain.total_interactions as number) ?? 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('client_id', clientId),
      );
    }
  }

  if (extraction.nutrition_updates) {
    const n = extraction.nutrition_updates;
    const { data: nutritionDoc } = await adminClient
      .from('pt_client_nutrition_doc')
      .select('favourite_foods, foods_to_avoid, nutrition_obstacles, recent_wins, recurring_gaps')
      .eq('client_id', clientId)
      .single();

    if (nutritionDoc) {
      const favFoods = (nutritionDoc.favourite_foods as string[]) ?? [];
      const avoidFoods = (nutritionDoc.foods_to_avoid as string[]) ?? [];
      const recentWins = (nutritionDoc.recent_wins as string[]) ?? [];
      const recurringGaps = (nutritionDoc.recurring_gaps as string[]) ?? [];

      if (n.food_preference) favFoods.push(n.food_preference);
      if (n.win) recentWins.push(n.win);
      if (n.obstacle) recurringGaps.push(n.obstacle);

      updates.push(
        adminClient
          .from('pt_client_nutrition_doc')
          .update({
            favourite_foods: favFoods.slice(-30),
            foods_to_avoid: avoidFoods.slice(-20),
            nutrition_obstacles: n.obstacle ?? nutritionDoc.nutrition_obstacles,
            recent_wins: recentWins.slice(-20),
            recurring_gaps: recurringGaps.slice(-20),
            updated_at: new Date().toISOString(),
          })
          .eq('client_id', clientId),
      );
    }
  }

  if (extraction.exercise_updates) {
    const e = extraction.exercise_updates;
    const { data: exerciseDoc } = await adminClient
      .from('pt_client_exercise_doc')
      .select('strong_movements, weak_movements, disliked_exercises, injury_history, current_limitations')
      .eq('client_id', clientId)
      .single();

    if (exerciseDoc) {
      const strongMovements = (exerciseDoc.strong_movements as string[]) ?? [];
      const weakMovements = (exerciseDoc.weak_movements as string[]) ?? [];
      const dislikedExercises = (exerciseDoc.disliked_exercises as string[]) ?? [];
      const injuryHistory = (exerciseDoc.injury_history as Array<Record<string, string>>) ?? [];

      if (e.strong_movement) strongMovements.push(e.strong_movement);
      if (e.weak_movement) weakMovements.push(e.weak_movement);
      if (e.injury) {
        injuryHistory.push({ description: e.injury, date: new Date().toISOString().split('T')[0], resolved: 'false' });
      }

      updates.push(
        adminClient
          .from('pt_client_exercise_doc')
          .update({
            strong_movements: strongMovements.slice(-30),
            weak_movements: weakMovements.slice(-30),
            disliked_exercises: dislikedExercises.slice(-30),
            injury_history: injuryHistory.slice(-20),
            current_limitations: e.injury ? e.injury : (exerciseDoc.current_limitations as string | null),
            updated_at: new Date().toISOString(),
          })
          .eq('client_id', clientId),
      );
    }
  }

  if (extraction.lifestyle_updates) {
    const l = extraction.lifestyle_updates;
    const { data: lifestyleDoc } = await adminClient
      .from('pt_client_lifestyle_doc')
      .select('recurring_challenges, wins')
      .eq('client_id', clientId)
      .single();

    if (lifestyleDoc) {
      const challenges = (lifestyleDoc.recurring_challenges as string[]) ?? [];
      const wins = (lifestyleDoc.wins as string[]) ?? [];

      if (l.challenge) challenges.push(l.challenge);
      if (l.win) wins.push(l.win);

      updates.push(
        adminClient
          .from('pt_client_lifestyle_doc')
          .update({
            recurring_challenges: challenges.slice(-20),
            wins: wins.slice(-20),
            updated_at: new Date().toISOString(),
          })
          .eq('client_id', clientId),
      );
    }
  }

  await Promise.allSettled(updates);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')!;

    const adminClient = createClient(supabaseUrl, serviceKey);
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization.' }, 401);

    const token = authHeader.replace('Bearer ', '');
    if (token !== serviceKey && jwtPayload(token).role !== 'service_role') {
      const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: authData, error: authError } = await userClient.auth.getUser();
      if (authError || !authData.user) return json({ error: 'Unauthorized.' }, 401);
    }

    const body = (await req.json()) as RequestBody;
    const { client_id, trigger_type, content, ai_response, structured_data, source_message_id } = body;

    if (!client_id || !trigger_type || !content) {
      return json({ error: 'Missing required fields.' }, 400);
    }

    // Write to hot inbox always
    const weekStart = getWeekStart(new Date());
    await adminClient.from('pt_client_recent_activity').insert({
      client_id,
      week_start: weekStart,
      activity_type: trigger_type,
      raw_content: content,
      ai_response: ai_response ?? null,
      structured_data: structured_data ?? {},
      source_message_id: source_message_id ?? null,
    });

    // Check feature flag
    const { data: clientRow } = await adminClient
      .from('pt_clients')
      .select('use_brain, name')
      .eq('id', client_id)
      .single();

    if (!clientRow?.use_brain && trigger_type !== 'workout_logged') {
      return json({ ok: true, brain_updated: false });
    }

    const structuredUpdated = await applyStructuredBrainUpdates(
      client_id,
      trigger_type,
      structured_data,
      adminClient,
    );

    // Read current brain state for extraction context
    const { data: brain } = await adminClient
      .from('pt_client_brain')
      .select('last_session_summary, personality_notes')
      .eq('client_id', client_id)
      .single();

    const extraction = await extractInsights(
      content,
      trigger_type,
      ai_response,
      {
        last_session_summary: (brain?.last_session_summary as string | null) ?? null,
        personality_notes: (brain?.personality_notes as Record<string, unknown>) ?? {},
      },
      anthropic,
    );

    await applyBrainUpdates(client_id, extraction, adminClient);

    return json({ ok: true, brain_updated: true, structured_updated: structuredUpdated });
  } catch (err) {
    console.error('update-client-brain error:', err);
    return json({ error: 'Internal error.' }, 500);
  }
});
