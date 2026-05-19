import { createClient } from 'npm:@supabase/supabase-js@2';
import OpenAI from 'npm:openai@4';

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

function buildSystemPrompt(params: {
  clientName: string;
  goals: string | null;
  coachingFocus: string | null;
  lifestyleContext: string | null;
  activeGoals: Array<{ title: string; target: string | null; status: string }>;
  programmeSummary: string | null;
  recentLogs: Array<{ phase_index: number; day_index: number; created_at: string }>;
  recentCheckins: Array<{ week_start: string; ai_weekly_focus: unknown }>;
  clientNotes: Array<{ content: string; created_at: string }>;
  knowledgeContext: string;
  brainContext: string | null;
}): string {
  const {
    clientName, goals, coachingFocus, lifestyleContext,
    activeGoals, programmeSummary, recentLogs, recentCheckins,
    clientNotes, knowledgeContext, brainContext,
  } = params;

  const goalsText = activeGoals.length > 0
    ? activeGoals.map((g) => `- ${g.title}${g.target ? ` (target: ${g.target})` : ''}`).join('\n')
    : (goals ?? 'Not specified');

  const logsText = recentLogs.length > 0
    ? `${recentLogs.length} recent sessions logged`
    : 'No recent sessions logged';

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

  return `You are Pedro Avila's AI coaching assistant -- the client's personal virtual trainer inside the Cerebro coaching app.

Pedro is a Brazilian-born, Sydney-based personal trainer and AI founder. You embody Pedro's coaching philosophy: evidence-based programming, progressive overload, and holistic health habits.

## Your role
- You are the client's always-available AI coach. You know everything about them.
- Answer questions about their programme, exercises, nutrition, recovery, and lifestyle.
- Give specific, actionable advice grounded in their current programme and history.
- You are warm, direct, and encouraging -- not robotic or overly formal.
- Keep responses concise and practical unless asked for detail.
- When you reference past events, weights, or conversations, do it naturally as if you remember them.

## Client: ${clientName}
**Goals:** ${goalsText}
**Coaching focus:** ${coachingFocus ?? 'General fitness'}
**Lifestyle context:** ${lifestyleContext ?? 'Not specified'}

## Current Programme
${programmeSummary ?? 'No active programme assigned yet.'}

## Training Activity
${logsText}

## Recent Check-ins
${checkinsText}

## Pedro's Coaching Notes
${notesText}

${brainContext ? `${brainContext}\n` : ''}${knowledgeContext ? `## Pedro's Knowledge Base (relevant excerpts)\n${knowledgeContext}\n` : ''}
## Nutrition Logging
If the client is describing food they ate or are about to eat (e.g. "just had X", "about to have X", "had X for lunch"), acknowledge that you'll log it and confirm: "[meal description] -- looks like ~Xg protein, Xg carbs, Xg fat (~X cals). Logged." Then ask a brief follow-up if useful.

## Important rules
- If the client mentions "hey pedro", "hi pedro", or explicitly asks to speak to Pedro directly, always reply: "I'll flag this for Pedro so he can follow up with you directly. In the meantime, [brief helpful note]."
- Never pretend to be Pedro himself -- you are his AI assistant.
- If you don't know something specific about the client, say so and give general guidance.
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

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceKey);
    const openai = new OpenAI({ apiKey: openaiKey });

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
      logsRes,
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
        .select('name, goal, current_week, current_block_index, programme')
        .eq('client_id', body.client_id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1),
      adminClient
        .from('pt_workout_logs')
        .select('phase_index, day_index, created_at')
        .eq('client_id', body.client_id)
        .order('created_at', { ascending: false })
        .limit(10),
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

    const activeAssignment = (assignmentRes.data ?? [])[0] ?? null;

    let programmeSummary: string | null = null;
    if (activeAssignment) {
      const prog = activeAssignment.programme as {
        phases?: Array<{ title: string; focus: string; weeks: string }>;
      } | null;
      const phases = prog?.phases ?? [];
      const phaseList = phases.map((p) => `${p.title} (${p.weeks}w)`).join(' -> ');
      const currentBlock = activeAssignment.current_block_index ?? 0;
      const phaseTitle = phases[currentBlock]?.title ?? 'Unknown phase';
      programmeSummary = `Programme: ${activeAssignment.name} | Goal: ${activeAssignment.goal ?? 'Not set'}\nCurrent phase: ${phaseTitle} (week ${activeAssignment.current_week ?? 1})\nProgramme structure: ${phaseList}`;
    }

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
      programmeSummary,
      recentLogs: (logsRes.data ?? []) as Array<{ phase_index: number; day_index: number; created_at: string }>,
      recentCheckins: (checkinsRes.data ?? []) as Array<{ week_start: string; ai_weekly_focus: unknown }>,
      clientNotes: (notesRes.data ?? []) as Array<{ content: string; created_at: string }>,
      knowledgeContext,
      brainContext,
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

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0.5,
      max_tokens: 600,
      messages: chatMessages,
    });

    const aiResponse = completion.choices[0]?.message?.content?.trim() ?? "I'm here to help -- could you rephrase that?";

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
