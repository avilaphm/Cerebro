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

const PEDRO_EMAILS = ['pedro@cerebroai.au', 'avila.phm@gmail.com', 'pedro@meetavila.com', 'pedroavila.phm@gmail.com'];

// Pillar B - clarifying questions. Before generating, look at the coach's request plus everything
// already known about the client (docs, brain, goals). If critical programming info is genuinely
// missing and cannot be inferred, return 1-3 short questions for the coach to answer first.
// If there is enough to build a good programme, return no questions and generation proceeds.
const SYSTEM = `You are a programming intake checker inside Pedro Avila's Cerebro coaching app.
You receive the coach's request for a new programme, plus everything already known about the client.
Decide whether you have enough to build a genuinely good, safe, personalised programme, or whether
1-3 critical details are missing and must be asked.

Return JSON only:
{
  "enough_info": boolean,
  "questions": string[]   // 0-3 short, specific questions; empty if enough_info is true
}

Ask ONLY for details that materially change the programme and are NOT already known or safely inferable:
- equipment / training environment (gym, home, bodyweight, bands, travel)
- injuries, pain, or movement limitations (if no assessment/screen is on file and none stated)
- training days per week / session length (if not stated and not standard)
- primary goal or focus (if the request is vague, e.g. "make me a workout")
- experience level (only if it materially changes the safe starting point and is unknown)
Rules:
- If a movement assessment / M&L screen or clear goals/equipment are already on file or stated, do NOT ask about them.
- Never ask more than 3 questions. Prefer 0. Ask one crisp question per genuinely missing item.
- Do not ask about things the coach already answered in the request.
- Output minified JSON only.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);
    const userSupa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await userSupa.auth.getUser();
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const email = (user.email ?? '').toLowerCase();
    if (!PEDRO_EMAILS.includes(email)) {
      const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (profile?.role !== 'admin') return json({ error: 'Only the coach can run this.' }, 403);
    }

    const body = await req.json() as { client_id?: string; request_text?: string };
    if (!body.client_id) return json({ error: 'client_id required' }, 400);
    const requestText = (body.request_text ?? '').trim();

    const [clientRes, docsRes, brainRes, exerciseDocRes] = await Promise.all([
      admin.from('pt_clients').select('name, goals, notes, lifestyle_context, coaching_focus, event_goal, regular_training_slot').eq('id', body.client_id).maybeSingle(),
      admin.from('pt_client_documents').select('document_type, title').eq('client_id', body.client_id).order('created_at', { ascending: false }).limit(20),
      admin.from('pt_client_brain').select('summary_current, important_decisions, key_phrases').eq('client_id', body.client_id).maybeSingle(),
      admin.from('pt_client_exercise_doc').select('injury_history, current_limitations, movement_assessment_summary').eq('client_id', body.client_id).maybeSingle(),
    ]);

    const docTypes = (docsRes.data ?? []).map((d) => d.document_type);
    const hasAssessment = docTypes.includes('movement_assessment')
      || Boolean((exerciseDocRes.data?.movement_assessment_summary as Record<string, unknown> | null)?.primary_issues);

    const knownContext = {
      client: clientRes.data ?? {},
      has_movement_assessment: hasAssessment,
      documents_on_file: docTypes,
      brain_summary: brainRes.data?.summary_current ?? '',
      known_decisions: brainRes.data?.important_decisions ?? [],
      injuries: exerciseDocRes.data?.injury_history ?? [],
      limitations: exerciseDocRes.data?.current_limitations ?? '',
    };

    const userMessage = [
      `COACH'S REQUEST FOR THIS PROGRAMME:\n${requestText || '(the coach did not type a specific request)'}`,
      `WHAT IS ALREADY KNOWN ABOUT THE CLIENT:\n${JSON.stringify(knownContext, null, 2)}`,
      'Decide if you have enough. Output the JSON now.',
    ].join('\n\n---\n\n');

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
    let parsed: { enough_info?: boolean; questions?: string[] } | null = null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25_000);
      try {
        const msg = await anthropic.messages.create(
          { model: 'claude-sonnet-4-6', max_tokens: 400, system: SYSTEM, messages: [{ role: 'user', content: userMessage }] },
          { signal: ctrl.signal },
        );
        const raw = (msg.content[0] as { text: string }).text.trim();
        const a = raw.indexOf('{'); const b = raw.lastIndexOf('}');
        parsed = a !== -1 && b > a ? JSON.parse(raw.slice(a, b + 1)) : JSON.parse(raw);
      } finally { clearTimeout(timer); }
    } catch (modelErr) {
      console.warn('suggest-clarifying-questions model fallback:', modelErr);
    }

    // Fallback: if the model is unavailable, do not block generation - ask nothing.
    const questions = Array.isArray(parsed?.questions)
      ? parsed!.questions.filter((q) => typeof q === 'string' && q.trim()).slice(0, 3)
      : [];

    return json({ ok: true, questions });
  } catch (error) {
    console.error('suggest-clarifying-questions error:', error);
    return json({ error: error instanceof Error ? error.message : 'Clarify check failed' }, 500);
  }
});
