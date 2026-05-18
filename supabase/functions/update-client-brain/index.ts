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

type TriggerType =
  | 'message'
  | 'food_log'
  | 'workout_logged'
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

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
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

    return json({ ok: true, brain_updated: true });
  } catch (err) {
    console.error('update-client-brain error:', err);
    return json({ error: 'Internal error.' }, 500);
  }
});
