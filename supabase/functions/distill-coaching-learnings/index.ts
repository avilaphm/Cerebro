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

// Self-improving loop (Pillar C, core). Reads the changes a coach recently made to a client's
// programme (from pt_events), plus the coach's stated "why", and distils a durable coaching
// learning that is written back into the client brain so FUTURE programme generation reflects it
// (client-analysis-agent reads pt_client_brain.important_decisions). This is what makes the
// generator get better every time the coach edits a client's programme.
const SYSTEM = `You are Pedro Avila's coaching-memory assistant inside the Cerebro app.
You receive the recent changes a coach made to ONE client's programme (exercise swaps, removals,
set changes, repositions), and optionally the coach's explanation of WHY.
Distil them into durable coaching guidance for THIS client that a programme-generating AI should
follow next time. Focus on repeated patterns and intent, not one-offs.

Return JSON only:
{
  "learnings": string[],   // 1-5 short, concrete, durable rules, e.g. "Swap deep squats for hip-hinge patterns - knee sensitivity" or "Prefers incline over flat bench"
  "summary": string        // 1-2 sentence plain-English summary of what changed and why
}
Rules:
- Only include a learning if it is genuinely durable guidance (a preference, constraint, or pattern), not a single incidental change.
- If the coach gave a reason, use it; do not invent reasons.
- Be specific and actionable. Output minified JSON only.`;

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
    const isPedro = PEDRO_EMAILS.includes(email);
    if (!isPedro) {
      const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (profile?.role !== 'admin') return json({ error: 'Only the coach can distil learnings.' }, 403);
    }

    const body = await req.json() as { client_id?: string; why?: string };
    if (!body.client_id) return json({ error: 'client_id required' }, 400);

    // Recent programme changes for this client (last 40, last 90 days).
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: events } = await admin
      .from('pt_events')
      .select('id, event_type, metadata, created_at')
      .eq('client_id', body.client_id)
      .in('event_type', ['programme_exercise_swapped', 'programme_exercise_removed', 'programme_sets_changed', 'programme_position_changed'])
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(40);

    if (!events || events.length === 0) {
      return json({ ok: true, learnings: [], summary: 'No recent programme changes to learn from.', events_used: 0 });
    }

    // Compact, readable change log for the model.
    const changeLines = events.map((e) => {
      const m = (e.metadata ?? {}) as Record<string, unknown>;
      if (e.event_type === 'programme_exercise_swapped') {
        const swaps = Array.isArray(m.swaps) ? m.swaps as Array<{ from?: string; to?: string }> : [];
        const pairs = swaps.map((s) => `${s.from ?? '?'} -> ${s.to ?? '?'}`).join('; ');
        return `Swapped: ${pairs}${m.reason ? ` (reason: ${m.reason})` : ''}`;
      }
      if (e.event_type === 'programme_exercise_removed') return `Removed: ${JSON.stringify(m).slice(0, 200)}`;
      if (e.event_type === 'programme_sets_changed') return `Changed sets: ${JSON.stringify(m).slice(0, 200)}`;
      return `Moved position: ${JSON.stringify(m).slice(0, 160)}`;
    });

    const userMessage = [
      `RECENT PROGRAMME CHANGES (most recent first):\n${changeLines.join('\n')}`,
      body.why?.trim() ? `COACH'S EXPLANATION OF WHY:\n${body.why.trim().slice(0, 2000)}` : 'The coach did not add an explanation.',
      'Distil the durable coaching learnings now. JSON only.',
    ].join('\n\n---\n\n');

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
    let parsed: { learnings?: string[]; summary?: string } | null = null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 40_000);
      try {
        const msg = await anthropic.messages.create(
          { model: 'claude-sonnet-4-6', max_tokens: 700, system: SYSTEM, messages: [{ role: 'user', content: userMessage }] },
          { signal: ctrl.signal },
        );
        const raw = (msg.content[0] as { text: string }).text.trim();
        const a = raw.indexOf('{'); const b = raw.lastIndexOf('}');
        parsed = a !== -1 && b > a ? JSON.parse(raw.slice(a, b + 1)) : JSON.parse(raw);
      } finally { clearTimeout(timer); }
    } catch (modelErr) {
      console.warn('distill-coaching-learnings model fallback:', modelErr);
    }

    const learnings = Array.isArray(parsed?.learnings) ? parsed!.learnings.filter((x) => typeof x === 'string' && x.trim()).slice(0, 5) : [];
    const summary = (parsed?.summary ?? '').trim() || `Reviewed ${events.length} recent programme change(s).`;

    // Write the learnings into the client brain so future generation reflects them. We append to
    // pt_client_brain.important_decisions, which the client-analysis agent reads at generation time.
    if (learnings.length > 0) {
      const stamped = learnings.map((l) => `[from programme edits ${new Date().toISOString().slice(0, 10)}] ${l}`);
      const { data: brain } = await admin.from('pt_client_brain').select('important_decisions').eq('client_id', body.client_id).maybeSingle();
      const current = Array.isArray(brain?.important_decisions) ? brain!.important_decisions as string[] : [];
      const merged = Array.from(new Set([...current, ...stamped])).slice(-40);
      await admin.from('pt_client_brain').upsert({ client_id: body.client_id, important_decisions: merged }, { onConflict: 'client_id' });
    }

    // Optionally stamp the coach's "why" onto the most recent change events for the record.
    if (body.why?.trim()) {
      for (const e of events.slice(0, 8)) {
        const m = (e.metadata ?? {}) as Record<string, unknown>;
        if (m.reason) continue;
        await admin.from('pt_events').update({ metadata: { ...m, reason: body.why!.trim(), reason_at: new Date().toISOString() } }).eq('id', e.id);
      }
    }

    return json({ ok: true, learnings, summary, events_used: events.length });
  } catch (error) {
    console.error('distill-coaching-learnings error:', error);
    return json({ error: error instanceof Error ? error.message : 'Distillation failed' }, 500);
  }
});
