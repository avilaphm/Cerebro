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

const SYSTEM_PROMPT = `You are a clinical-grade PT coach analyst working for Pedro Avila's coaching system (Cerebro).
You read every available document about a client — their master profile, current nutrition, current training, lifestyle —
plus uploaded intake notes, and you output a structured analysis of who this client is, what they need, and what
emphasis the programme should take.

You speak no fluff. Your job is to surface what the programme synthesis AI must know to build the right programme.

OUTPUT FORMAT: valid JSON only, matching this schema:
{
  "goals": {
    "primary": string,
    "secondary": string[],
    "emotional_drivers": string,
    "timeline": string
  },
  "constraints": {
    "injuries": string[],
    "asymmetries": string[],
    "mobility_restrictions": string[],
    "equipment": string[],
    "schedule": string
  },
  "preferences": {
    "exercise_likes": string[],
    "exercise_dislikes": string[],
    "training_history": string
  },
  "emphasis": {
    "priority": "fat_loss" | "hypertrophy" | "strength" | "general_health" | "mobility",
    "needs_cardio_block": boolean,
    "needs_mobility_block": boolean,
    "compound_readiness": "low" | "medium" | "high"
  },
  "key_findings": string[],
  "cited_sources": [{ "doc_type": "master"|"nutrition"|"exercise"|"lifestyle"|"intake", "excerpt": string }]
}

RULES:
- needs_cardio_block = true if the client's primary or secondary goal includes fat loss, body composition, conditioning, or cardiovascular health.
- needs_mobility_block = true if the client has reported mobility restrictions, stiffness, desk-bound lifestyle, recent injury recovery, or asked for flexibility work.
- compound_readiness = 'low' if injuries or movement quality concerns dominate; 'high' if client has clean prior lifting experience; 'medium' otherwise.
- key_findings: 3-6 short sentences that the synthesis AI MUST honor (e.g., "Right shoulder instability — avoid overhead pressing in first 4 weeks").
- cited_sources: quote actual phrases from the source docs, do not invent. Keep each excerpt under 15 words and include at most 5 sources.

KEEP THE OUTPUT COMPACT. Every string field should be a short phrase, not a paragraph. Arrays hold at most 6 items. Do not pretty-print with deep nesting. The entire JSON must be complete and self-closing — never stop mid-object.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization') ?? '';
  const internalSecret = Deno.env.get('CEREBRO_INTERNAL_SECRET');
  if (!internalSecret || authHeader !== `Bearer ${internalSecret}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await req.json() as { client_id?: string; intake_text?: string };
    if (!body.client_id) return json({ error: 'client_id required' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const [clientRes, masterRes, nutritionRes, exerciseRes, lifestyleRes, documentsRes] = await Promise.all([
      admin.from('pt_clients').select('id, name, last_name, email, goals, notes, lifestyle_context, coaching_focus, event_goal, regular_training_slot').eq('id', body.client_id).maybeSingle(),
      admin.from('pt_client_brain').select('personality_notes, key_phrases, milestones, summary_current, summary_30d, summary_60d, coaching_reasoning, important_decisions').eq('client_id', body.client_id).maybeSingle(),
      admin.from('pt_client_nutrition_doc').select('typical_meals, favourite_foods, foods_to_avoid, nutrition_obstacles, eating_habits, daily_targets, recent_wins, recurring_gaps').eq('client_id', body.client_id).maybeSingle(),
      admin.from('pt_client_exercise_doc').select('strong_movements, weak_movements, disliked_exercises, injury_history, current_limitations, current_1rm, movement_assessment_summary, progression_strategy').eq('client_id', body.client_id).maybeSingle(),
      admin.from('pt_client_lifestyle_doc').select('sleep_baseline, stress_patterns, schedule_notes, social_context, recurring_challenges, wins, goals_context').eq('client_id', body.client_id).maybeSingle(),
      admin.from('pt_client_documents').select('document_type, title, content_text').eq('client_id', body.client_id).limit(5),
    ]);

    if (clientRes.error || !clientRes.data) return json({ error: 'Client not found' }, 404);

    const userMessage = buildUserMessage({
      client: clientRes.data,
      master: masterRes.data,
      nutrition: nutritionRes.data,
      exercise: exerciseRes.data,
      lifestyle: lifestyleRes.data,
      documents: documentsRes.data ?? [],
      intakeText: body.intake_text,
    });

    let analysis: Record<string, unknown> | null = null;
    try {
      const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
      const claudeCtrl = new AbortController();
      const claudeTimer = setTimeout(() => claudeCtrl.abort(), 60_000);
      let text: string;
      try {
        const msg = await anthropic.messages.create(
          { model: 'claude-sonnet-4-6', max_tokens: 4096, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userMessage }] },
          { signal: claudeCtrl.signal },
        );
        text = (msg.content[0] as { text: string }).text;
      } finally { clearTimeout(claudeTimer); }
      analysis = parseJson(text);
    } catch (modelError) {
      console.warn('client-analysis-agent model fallback:', modelError);
    }
    if (!analysis) {
      analysis = buildFallbackClientAnalysis({
        client: clientRes.data,
        master: masterRes.data,
        nutrition: nutritionRes.data,
        exercise: exerciseRes.data,
        lifestyle: lifestyleRes.data,
        documents: documentsRes.data ?? [],
        intakeText: body.intake_text,
      });
    }

    return json({ ok: true, analysis });
  } catch (error) {
    console.error('client-analysis-agent error:', error);
    return json({ error: error instanceof Error ? error.message : 'Analysis failed' }, 500);
  }
});

function buildUserMessage(ctx: {
  client: Record<string, unknown>;
  master: Record<string, unknown> | null;
  nutrition: Record<string, unknown> | null;
  exercise: Record<string, unknown> | null;
  lifestyle: Record<string, unknown> | null;
  documents: Array<{ document_type: string; title: string; content_text: string | null }>;
  intakeText?: string;
}): string {
  const parts: string[] = [];
  parts.push(`CLIENT BASICS:\n${JSON.stringify(ctx.client, null, 2)}`);
  if (ctx.master) parts.push(`MASTER BRAIN:\n${JSON.stringify(ctx.master, null, 2)}`);
  if (ctx.nutrition) parts.push(`NUTRITION DOC:\n${JSON.stringify(ctx.nutrition, null, 2)}`);
  if (ctx.exercise) parts.push(`EXERCISE DOC:\n${JSON.stringify(ctx.exercise, null, 2)}`);
  if (ctx.lifestyle) parts.push(`LIFESTYLE DOC:\n${JSON.stringify(ctx.lifestyle, null, 2)}`);
  if (ctx.intakeText) parts.push(`COACH NOTES / INTAKE TEXT:\n${ctx.intakeText.slice(0, 8000)}`);
  if (ctx.documents.length > 0) {
    const docs = ctx.documents
      .map((d) => `[${d.document_type}] ${d.title}:\n${(d.content_text ?? '').slice(0, 4000)}`)
      .join('\n\n');
    parts.push(`UPLOADED DOCUMENTS:\n${docs}`);
  }
  parts.push('Output the ClientAnalysis JSON now. Do not include any prose before or after the JSON.');
  return parts.join('\n\n---\n\n');
}

function tryParse(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
  } catch { return null; }
}

// Closes a JSON object that was cut off mid-stream (e.g. the model hit max_tokens).
// Walks the string tracking string/escape state and the open-bracket stack, then
// trims any dangling fragment and appends the missing closers so JSON.parse can succeed.
function closeTruncatedJson(s: string): string {
  let inStr = false, esc = false;
  const stack: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = s;
  if (inStr) out += '"';
  out = out.replace(/\s+$/, '').replace(/,\s*$/, '');
  out = out.replace(/,?\s*"[^"]*"\s*:\s*$/, '').replace(/,\s*$/, '');
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i];
  return out;
}

function parseJson(text: string): Record<string, unknown> | null {
  const t = text.trim();
  let v = tryParse(t);
  if (v) return v;
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) { v = tryParse(fenced[1].trim()); if (v) return v; }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a !== -1 && b > a) { v = tryParse(t.slice(a, b + 1)); if (v) return v; }
  if (a !== -1) { v = tryParse(closeTruncatedJson(t.slice(a))); if (v) return v; }
  return null;
}

function buildFallbackClientAnalysis(ctx: {
  client: Record<string, unknown>;
  master: Record<string, unknown> | null;
  nutrition: Record<string, unknown> | null;
  exercise: Record<string, unknown> | null;
  lifestyle: Record<string, unknown> | null;
  documents: Array<{ document_type: string; title: string; content_text: string | null }>;
  intakeText?: string;
}): Record<string, unknown> {
  const raw = [
    JSON.stringify(ctx.client),
    JSON.stringify(ctx.master ?? {}),
    JSON.stringify(ctx.exercise ?? {}),
    JSON.stringify(ctx.lifestyle ?? {}),
    ctx.intakeText ?? '',
    ...ctx.documents.map((doc) => doc.content_text ?? ''),
  ].join('\n').toLowerCase();
  const injuries = keywordList(raw, ['shoulder', 'knee', 'back', 'hip', 'ankle', 'neck', 'wrist', 'elbow']);
  const mobility = keywordList(raw, ['tight', 'mobility', 'stiff', 'range of motion', 'rotation', 'flexor', 'adductor', 'hamstring', 'thoracic']);
  const equipment = keywordList(raw, ['gym', 'dumbbell', 'barbell', 'kettlebell', 'cable', 'machine', 'band', 'bodyweight', 'home']);
  const goals = typeof ctx.client.goals === 'string' ? ctx.client.goals : '';
  const needsCardio = /fat loss|conditioning|cardio|fitness|body composition|weight loss/.test(raw);
  const needsMobility = mobility.length > 0 || /desk|sedentary|stiff|pain/.test(raw);
  return {
    goals: {
      primary: goals || 'Build strength, movement quality, and consistency',
      secondary: [],
      emotional_drivers: '',
      timeline: '',
    },
    constraints: {
      injuries,
      asymmetries: keywordList(raw, ['left', 'right', 'asymmetry', 'imbalance', 'weak glute']),
      mobility_restrictions: mobility,
      equipment,
      schedule: stringValue(ctx.client.regular_training_slot, ''),
    },
    preferences: {
      exercise_likes: [],
      exercise_dislikes: Array.isArray(ctx.exercise?.disliked_exercises) ? ctx.exercise?.disliked_exercises : [],
      training_history: stringValue(ctx.exercise?.strong_movements, ''),
    },
    emphasis: {
      priority: needsCardio ? 'fat_loss' : needsMobility ? 'mobility' : 'strength',
      needs_cardio_block: needsCardio,
      needs_mobility_block: needsMobility,
      compound_readiness: injuries.length > 0 || mobility.length > 2 ? 'medium' : 'high',
    },
    key_findings: [
      goals ? `Goal: ${goals}` : 'Goal not clearly specified.',
      injuries.length > 0 ? `Relevant areas: ${injuries.join(', ')}.` : 'No acute injury history found in fallback scan.',
      needsMobility ? 'Mobility restrictions should shape Foundation exercise selection.' : 'Foundation can prioritise strength skill acquisition.',
    ],
    cited_sources: ctx.documents.slice(0, 5).map((doc) => ({
      doc_type: doc.document_type,
      excerpt: (doc.content_text ?? doc.title ?? '').slice(0, 90),
    })),
    fallback_used: true,
  };
}

function keywordList(raw: string, keywords: string[]): string[] {
  return keywords.filter((keyword) => raw.includes(keyword));
}

function stringValue(value: unknown, fallback: string): string {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string').join(', ');
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
