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
- cited_sources: quote actual phrases from the source docs, do not invent.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

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

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = (msg.content[0] as { text: string }).text;
    const analysis = parseJson(text);
    if (!analysis) return json({ error: 'Analysis did not return valid JSON', raw: text }, 502);

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

function parseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenced) {
      try { return JSON.parse(fenced[1]); } catch { /* noop */ }
    }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try { return JSON.parse(text.slice(firstBrace, lastBrace + 1)); } catch { /* noop */ }
    }
    return null;
  }
}
