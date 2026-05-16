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
}): string {
  const {
    clientName, goals, coachingFocus, lifestyleContext,
    activeGoals, programmeSummary, recentLogs, recentCheckins,
    clientNotes, knowledgeContext,
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

  return `You are Pedro Avila's AI coaching assistant — the client's personal virtual trainer inside the Cerebro coaching app.

Pedro is a Brazilian-born, Sydney-based personal trainer and AI founder. You embody Pedro's coaching philosophy: evidence-based programming, progressive overload, and holistic health habits.

## Your role
- You are the client's always-available AI coach. You know everything about them.
- Answer questions about their programme, exercises, nutrition, recovery, and lifestyle.
- Give specific, actionable advice grounded in their current programme and history.
- You are warm, direct, and encouraging — not robotic or overly formal.
- Keep responses concise and practical unless asked for detail.

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

${knowledgeContext ? `## Pedro's Knowledge Base (relevant excerpts)\n${knowledgeContext}\n` : ''}

## Important rules
- If the client mentions "hey pedro", "hi pedro", or explicitly asks to speak to Pedro directly, always reply: "I'll flag this for Pedro so he can follow up with you directly. In the meantime, [brief helpful note]."
- Never pretend to be Pedro himself — you are his AI assistant.
- If you don't know something specific about the client, say so and give general guidance.
- For medical concerns or injuries, always recommend the client consult a healthcare professional.
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
      .select('id, name, goals, coaching_focus, lifestyle_context')
      .eq('id', body.client_id)
      .eq('user_id', authData.user.id)
      .single();

    if (!clientRow) return json({ error: 'Client not found.' }, 404);

    const client = clientRow as {
      id: string; name: string; goals: string | null;
      coaching_focus: string | null; lifestyle_context: string | null;
    };

    // Detect "hey pedro" / handoff request
    const wantsPedro = /\b(hey|hi|hello)\s+pedro\b/i.test(body.content);

    // Fetch all client context in parallel with knowledge search
    const [
      goalsRes,
      assignmentRes,
      logsRes,
      checkinsRes,
      notesRes,
      historyRes,
      knowledgeContext,
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
    ]);

    const activeAssignment = (assignmentRes.data ?? [])[0] ?? null;

    // Build programme summary from assignment
    let programmeSummary: string | null = null;
    if (activeAssignment) {
      const prog = activeAssignment.programme as {
        phases?: Array<{ title: string; focus: string; weeks: string }>;
      } | null;
      const phases = prog?.phases ?? [];
      const phaseList = phases.map((p) => `${p.title} (${p.weeks}w)`).join(' → ');
      const currentBlock = activeAssignment.current_block_index ?? 0;
      const phaseTitle = phases[currentBlock]?.title ?? 'Unknown phase';
      programmeSummary = `Programme: ${activeAssignment.name} | Goal: ${activeAssignment.goal ?? 'Not set'}\nCurrent phase: ${phaseTitle} (week ${activeAssignment.current_week ?? 1})\nProgramme structure: ${phaseList}`;
    }

    // Build conversation history for OpenAI (oldest first, exclude the just-sent message)
    const history = ((historyRes.data ?? []) as Array<{ sender: string; content: string; created_at: string }>)
      .reverse()
      .filter((m) => m.content !== body.content)
      .slice(-20);

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
    });

    const chatMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((m): OpenAI.Chat.ChatCompletionMessageParam => ({
        role: m.sender === 'client' ? 'user' : 'assistant',
        content: m.content,
      })),
      { role: 'user', content: body.content },
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0.5,
      max_tokens: 600,
      messages: chatMessages,
    });

    const aiResponse = completion.choices[0]?.message?.content?.trim() ?? "I'm here to help — could you rephrase that?";

    // If handoff requested, mark the original client message and create a coaching task
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
            description: `Client message: "${body.content}"`,
            status: 'pending',
            priority: 'high',
            due_date: new Date().toISOString().split('T')[0],
          })
          .select('id')
          .single(),
      ]);
    }

    // Insert the AI response into pt_messages
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

    return json({ ok: true, response: aiResponse, handoff_requested: wantsPedro });
  } catch (err) {
    console.error('ai-client-chat error:', err);
    return json({ error: 'Internal error.' }, 500);
  }
});
