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

const SYSTEM_PROMPT = `You are a physiotherapy-grade movement analyst working inside Pedro Avila's Cerebro coaching system.

You read all available client documents and analyze movement limitations, injuries, and complaints exactly the way a physiotherapist would. You identify root cause muscles — not just symptoms — and classify each muscle as WEAK or TIGHT.

TIGHT MUSCLES are almost always a protective mechanism. The brain shortens the muscle to protect the joint because something nearby is weak. Treatment = strengthen through full range of motion + flexibility work + mobility. Not just stretching.

WEAK MUSCLES need progressive strengthening.

Go upstream from symptoms to root causes. Knee pain is often weak glutes. Lower back stiffness is often weak core + tight hip flexors causing anterior pelvic tilt. Shoulder instability is often weak rotator cuff + poor scapular control. Never stop at the symptom.

OUTPUT FORMAT: valid JSON only, this exact shape:
{
  "muscle_mind_map": {
    "client_id": string,
    "primary_issues": [
      {
        "issue": string,
        "symptom_location": string,
        "root_cause": string,
        "muscles": [
          {
            "name": string,
            "specific_muscles": string[],
            "status": "weak" | "tight",
            "treatment": string,
            "priority": "high" | "medium" | "low"
          }
        ]
      }
    ],
    "secondary_findings": string[],
    "overall_level": "beginner" | "intermediate" | "advanced",
    "compound_readiness": "low" | "medium" | "high",
    "severity": "mild" | "moderate" | "severe",
    "programme_flags": {
      "avoid_overhead_pressing_initially": boolean,
      "prioritise_posterior_chain": boolean,
      "needs_mobility_block": boolean,
      "needs_cardio_block": boolean
    }
  }
}

RULES:
- Never leave a muscle unclassified. Every muscle is either weak or tight.
- compound_readiness: low = injuries or movement quality concerns dominate; high = clean lifting history, ready for barbell compounds from day 1; medium = somewhere between.
- overall_level: beginner = little consistent training history, unfamiliar with compound movements; intermediate = 1-2 years consistent training; advanced = 3+ years technically proficient.
- severity: mild = minor niggles, no real injury; moderate = one or two genuine issues needing programming consideration; severe = significant history or multiple compounding issues.
- programme_flags must directly reflect the findings. If any shoulder instability or impingement: avoid_overhead_pressing_initially = true.
- If the client has no injury history or movement documentation, produce a conservative mind map based on their training level and goals.
- Output JSON only. No prose before or after.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json() as {
      client_id: string;
      client_analysis?: Record<string, unknown>;
      intake_text?: string;
    };
    if (!body.client_id) return json({ error: 'client_id required' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const [clientRes, exerciseDocRes, brainRes, documentsRes] = await Promise.all([
      admin.from('pt_clients').select('id, name, goals, notes, coaching_focus').eq('id', body.client_id).maybeSingle(),
      admin.from('pt_client_exercise_doc').select('injury_history, current_limitations, movement_assessment_summary, weak_movements, strong_movements').eq('client_id', body.client_id).maybeSingle(),
      admin.from('pt_client_brain').select('coaching_reasoning, key_phrases, important_decisions, summary_current').eq('client_id', body.client_id).maybeSingle(),
      admin.from('pt_client_documents').select('document_type, title, content_text').eq('client_id', body.client_id).limit(5),
    ]);

    if (!clientRes.data) return json({ error: 'Client not found' }, 404);

    const parts: string[] = [];
    parts.push(`CLIENT:\n${JSON.stringify(clientRes.data, null, 2)}`);
    if (exerciseDocRes.data) parts.push(`EXERCISE DOC:\n${JSON.stringify(exerciseDocRes.data, null, 2)}`);
    if (brainRes.data) parts.push(`CLIENT BRAIN:\n${JSON.stringify(brainRes.data, null, 2)}`);
    if (body.client_analysis) parts.push(`CLIENT ANALYSIS (prior step):\n${JSON.stringify(body.client_analysis, null, 2)}`);
    if (body.intake_text) parts.push(`INTAKE NOTES:\n${body.intake_text.slice(0, 6000)}`);
    if (documentsRes.data?.length) {
      parts.push(`UPLOADED DOCUMENTS:\n${documentsRes.data.map((d) => `[${d.document_type}] ${d.title}:\n${(d.content_text ?? '').slice(0, 3000)}`).join('\n\n')}`);
    }
    parts.push('Output the muscle_mind_map JSON now. JSON only, no prose, no code fences.');

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
    const userMessage = parts.join('\n\n---\n\n');
    const claudeCtrl = new AbortController();
    const claudeTimer = setTimeout(() => claudeCtrl.abort(), 60_000);
    let text: string;
    try {
      const msg = await anthropic.messages.create(
        { model: 'claude-sonnet-4-6', max_tokens: 2500, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userMessage }] },
        { signal: claudeCtrl.signal },
      );
      text = (msg.content[0] as { text: string }).text;
    } finally { clearTimeout(claudeTimer); }
    const parsed = parseJson(text);
    if (!parsed) return json({ error: 'Movement analysis did not return valid JSON' }, 502);

    const mindMap = (parsed.muscle_mind_map ?? parsed) as Record<string, unknown>;

    // Persist the mind map so future sessions can access it without re-running analysis.
    await admin.from('pt_client_exercise_doc').update({
      movement_assessment_summary: JSON.stringify(mindMap),
    }).eq('client_id', body.client_id);

    return json({ ok: true, muscle_mind_map: mindMap });
  } catch (error) {
    console.error('movement-analysis-agent error:', error);
    return json({ error: error instanceof Error ? error.message : 'Movement analysis failed' }, 500);
  }
});

function parseJson(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text); } catch { /* noop */ }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* noop */ } }
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a !== -1 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch { /* noop */ } }
  return null;
}
