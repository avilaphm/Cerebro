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
const METHODOLOGY_TITLE = 'Pedro Methodology (learned from coaching)';

// Pillar C - global loop. Distils Pedro's coaching methodology from what he does ACROSS all
// clients (recent programme edits + the per-client learnings already saved to each brain) into a
// single global "pedro_methodology" knowledge doc. This doc is threaded into generation for every
// client (exercise-intelligence agent + methodology RAG), so the whole system compounds - it gets
// better for everyone each time Pedro coaches, not just for one client.
const SYSTEM = `You are Pedro Avila's head-coach methodology assistant inside Cerebro.
You receive patterns from across ALL of Pedro's clients: the changes he repeatedly makes to
generated programmes, and the durable per-client learnings already saved. Distil his GENERAL
coaching methodology - the rules he applies broadly, not client-specific details.

Return JSON only:
{
  "rules": string[],     // 5-15 concise, durable, GENERAL coaching rules (exercise selection, substitutions, progression, structure, cues) that a programme-generating AI should apply to every client unless a client's own data overrides it
  "summary": string      // 1-2 sentence summary of Pedro's coaching style as observed
}
Rules:
- Generalise across clients. Include a rule only if it reflects a repeated pattern or clear preference, not a one-off.
- Do not include a client's name or client-specific medical detail; keep it general methodology.
- Be concrete and actionable (e.g. "Prefer hip-hinge patterns over deep bilateral squats when knee sensitivity is present", "Introduce the Big 5 only after movement quality is confirmed").
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
      if (profile?.role !== 'admin') return json({ error: 'Only the coach can update methodology.' }, 403);
    }

    // Signal 1: recent programme changes across ALL clients.
    const since = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    const { data: events } = await admin
      .from('pt_events')
      .select('event_type, metadata, created_at')
      .in('event_type', ['programme_exercise_swapped', 'programme_exercise_removed', 'programme_sets_changed'])
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(120);

    // Signal 2: the per-client learnings already distilled into each brain.
    const { data: brains } = await admin
      .from('pt_client_brain')
      .select('important_decisions')
      .limit(200);

    const swapLines: string[] = [];
    for (const e of events ?? []) {
      const m = (e.metadata ?? {}) as Record<string, unknown>;
      if (e.event_type === 'programme_exercise_swapped' && Array.isArray(m.swaps)) {
        (m.swaps as Array<{ from?: string; to?: string }>).forEach((s) => swapLines.push(`${s.from ?? '?'} -> ${s.to ?? '?'}${m.reason ? ` (${m.reason})` : ''}`));
      }
    }
    const learnings: string[] = [];
    for (const b of brains ?? []) {
      if (Array.isArray(b.important_decisions)) {
        (b.important_decisions as string[]).forEach((d) => { if (typeof d === 'string' && d.trim()) learnings.push(d.trim()); });
      }
    }

    if (swapLines.length === 0 && learnings.length === 0) {
      return json({ ok: true, rules: [], summary: 'Not enough coaching signal yet - make some programme changes and save per-client learnings first.' });
    }

    const userMessage = [
      `REPEATED EXERCISE SWAPS ACROSS CLIENTS (${swapLines.length}):\n${swapLines.slice(0, 120).join('\n')}`,
      `PER-CLIENT LEARNINGS ALREADY SAVED (${learnings.length}):\n${learnings.slice(0, 120).join('\n')}`,
      'Distil Pedro\'s general coaching methodology now. JSON only.',
    ].join('\n\n---\n\n');

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
    let parsed: { rules?: string[]; summary?: string } | null = null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45_000);
      try {
        const msg = await anthropic.messages.create(
          { model: 'claude-sonnet-4-6', max_tokens: 1200, system: SYSTEM, messages: [{ role: 'user', content: userMessage }] },
          { signal: ctrl.signal },
        );
        const raw = (msg.content[0] as { text: string }).text.trim();
        const a = raw.indexOf('{'); const b = raw.lastIndexOf('}');
        parsed = a !== -1 && b > a ? JSON.parse(raw.slice(a, b + 1)) : JSON.parse(raw);
      } finally { clearTimeout(timer); }
    } catch (modelErr) {
      console.warn('distill-global-methodology model fallback:', modelErr);
    }

    const rules = Array.isArray(parsed?.rules) ? parsed!.rules.filter((r) => typeof r === 'string' && r.trim()).slice(0, 15) : [];
    const summary = (parsed?.summary ?? '').trim() || `Reviewed ${swapLines.length} swaps and ${learnings.length} client learnings.`;
    if (rules.length === 0) return json({ ok: true, rules: [], summary });

    const contentText = `PEDRO'S COACHING METHODOLOGY (learned from his own coaching across clients; apply to every client unless that client's own data overrides it):\n\n${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\nStyle: ${summary}\nUpdated: ${new Date().toISOString().slice(0, 10)}`;

    // Upsert the single pedro_methodology doc (one evolving doc, not a new row each time).
    const { data: existing } = await admin
      .from('pt_knowledge_documents')
      .select('id')
      .eq('source', 'pedro_methodology')
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      await admin.from('pt_knowledge_documents').update({ title: METHODOLOGY_TITLE, content_text: contentText }).eq('id', existing.id);
    } else {
      await admin.from('pt_knowledge_documents').insert({ source: 'pedro_methodology', title: METHODOLOGY_TITLE, content_text: contentText });
    }

    return json({ ok: true, rules, summary });
  } catch (error) {
    console.error('distill-global-methodology error:', error);
    return json({ error: error instanceof Error ? error.message : 'Methodology distillation failed' }, 500);
  }
});
