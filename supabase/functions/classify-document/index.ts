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

// One upload box, smart routing. This reads a document a coach uploaded for a client and decides
// which pathway it belongs to: a training workout/programme to REPRODUCE, or background
// KNOWLEDGE about the client (intake form, movement/M&L assessment, profile, notes) to ingest
// into the client brain. It returns a route + a document_type; the caller sends it onward.
const SYSTEM = `You are a document router inside Pedro Avila's Cerebro coaching app.
You receive the text of ONE document a coach uploaded for a client. Decide what it is.

Return JSON only, no prose:
{
  "kind": "workout" | "knowledge",
  "document_type": "intake" | "movement_assessment" | "profile" | "other",
  "title": string,        // a short human title for the document
  "reason": string        // one short sentence on why
}

Rules:
- "workout" = an actual training session/programme/phase: lists of exercises with sets/reps/days,
  a week plan, a workout the coach wrote to give a client. These should be reproduced as a programme.
- "knowledge" = information ABOUT the client, not a workout to run: an intake/onboarding form,
  a movement screening or M&L (movement & lifestyle) assessment, a client profile, medical/injury
  history, goals, lifestyle notes. These inform programming but are not themselves a workout.
- For "knowledge", pick document_type: movement_assessment (movement screen / M&L / physio findings),
  intake (onboarding/intake form or questionnaire), profile (general client profile), or other.
- For "workout", document_type is "other".
- If a document mixes both, choose "workout" only if the dominant content is a runnable session/programme;
  otherwise "knowledge".
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

    const body = await req.json() as { text?: string };
    const text = (body.text ?? '').trim();
    if (text.length < 10) return json({ error: 'Provide at least a sentence of document text.' }, 400);

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
    let parsed: { kind?: string; document_type?: string; title?: string; reason?: string } | null = null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25_000);
      try {
        const msg = await anthropic.messages.create(
          {
            model: 'claude-sonnet-4-6',
            max_tokens: 300,
            system: SYSTEM,
            messages: [{ role: 'user', content: `DOCUMENT TEXT:\n${text.slice(0, 8000)}\n\nClassify it now. JSON only.` }],
          },
          { signal: ctrl.signal },
        );
        const raw = (msg.content[0] as { text: string }).text.trim();
        const a = raw.indexOf('{');
        const b = raw.lastIndexOf('}');
        parsed = a !== -1 && b > a ? JSON.parse(raw.slice(a, b + 1)) : JSON.parse(raw);
      } finally { clearTimeout(timer); }
    } catch (modelErr) {
      console.warn('classify-document model fallback:', modelErr);
    }

    // Deterministic fallback: look for workout signals (sets x reps, day headers, exercise lists).
    const kind = parsed?.kind === 'workout' || parsed?.kind === 'knowledge'
      ? parsed.kind
      : (/\b\d+\s*(x|sets?|reps?)\b|\bday\s*\d|\bweek\s*\d|superset|warm[\s-]?up/i.test(text) ? 'workout' : 'knowledge');
    const documentType = kind === 'workout'
      ? 'other'
      : (['intake', 'movement_assessment', 'profile', 'other'].includes(parsed?.document_type ?? '')
        ? parsed!.document_type!
        : (/movement|screen|assessment|posture|mobility|physio|m&l/i.test(text) ? 'movement_assessment' : 'intake'));

    return json({
      ok: true,
      kind,
      document_type: documentType,
      title: (parsed?.title ?? '').trim() || (kind === 'workout' ? 'Uploaded workout' : 'Client document'),
      reason: (parsed?.reason ?? '').trim(),
    });
  } catch (error) {
    console.error('classify-document error:', error);
    return json({ error: error instanceof Error ? error.message : 'Classification failed' }, 500);
  }
});
