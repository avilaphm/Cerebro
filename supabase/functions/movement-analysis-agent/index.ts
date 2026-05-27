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

  const authHeader = req.headers.get('Authorization') ?? '';
  const internalSecret = Deno.env.get('CEREBRO_INTERNAL_SECRET');
  if (!internalSecret || authHeader !== `Bearer ${internalSecret}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

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

    const userMessage = parts.join('\n\n---\n\n');
    let parsed: Record<string, unknown> | null = null;
    try {
      const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
      const claudeCtrl = new AbortController();
      const claudeTimer = setTimeout(() => claudeCtrl.abort(), 85_000);
      let text: string;
      try {
        const msg = await anthropic.messages.create(
          { model: 'claude-sonnet-4-6', max_tokens: 3000, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userMessage }] },
          { signal: claudeCtrl.signal },
        );
        text = (msg.content[0] as { text: string }).text;
      } finally { clearTimeout(claudeTimer); }
      parsed = parseJson(text);
    } catch (modelError) {
      console.warn('movement-analysis-agent model fallback:', modelError);
    }

    const mindMap = ((parsed?.muscle_mind_map ?? parsed) as Record<string, unknown> | null) ??
      buildFallbackMindMap({
        clientId: body.client_id,
        client: clientRes.data,
        exerciseDoc: exerciseDocRes.data,
        brain: brainRes.data,
        clientAnalysis: body.client_analysis,
        documents: documentsRes.data ?? [],
        intakeText: body.intake_text,
      });

    // Persist the mind map so future sessions can access it without re-running analysis.
    await admin.from('pt_client_exercise_doc').update({
      movement_assessment_summary: mindMap,
    }).eq('client_id', body.client_id);

    return json({ ok: true, muscle_mind_map: mindMap });
  } catch (error) {
    console.error('movement-analysis-agent error:', error);
    return json({ error: error instanceof Error ? error.message : 'Movement analysis failed' }, 500);
  }
});

function tryParse(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
  } catch { return null; }
}

// Closes a JSON object cut off mid-stream (model hit max_tokens). Tracks string/escape
// state and the open-bracket stack, trims any dangling fragment, appends missing closers.
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

function buildFallbackMindMap(ctx: {
  clientId: string;
  client: Record<string, unknown>;
  exerciseDoc: Record<string, unknown> | null;
  brain: Record<string, unknown> | null;
  clientAnalysis?: Record<string, unknown>;
  documents: Array<{ document_type: string; title: string; content_text: string | null }>;
  intakeText?: string;
}): Record<string, unknown> {
  const raw = [
    JSON.stringify(ctx.client),
    JSON.stringify(ctx.exerciseDoc ?? {}),
    JSON.stringify(ctx.brain ?? {}),
    JSON.stringify(ctx.clientAnalysis ?? {}),
    ctx.intakeText ?? '',
    ...ctx.documents.map((doc) => doc.content_text ?? ''),
  ].join('\n').toLowerCase();

  const issues: Array<Record<string, unknown>> = [];

  if (hasAny(raw, ['hip', 'glute', 'adductor', 'hamstring', 'lower back', 'low back', 'lumbar', 'pelvis', 'squat', 'hinge'])) {
    issues.push({
      issue: 'Hip and posterior-chain control',
      symptom_location: hasAny(raw, ['lower back', 'low back', 'lumbar']) ? 'lower back and hips' : 'hips and lower body',
      root_cause: 'Likely weak glutes and trunk control with protective tightness through hip flexors, hamstrings, or adductors.',
      muscles: [
        muscle('Glutes', ['glute max', 'glute med'], 'weak', 'Strengthen through hip extension, abduction, unilateral loading, and full-range lower-body patterns.', 'high'),
        muscle('Hip flexors', ['iliopsoas', 'rectus femoris'], 'tight', 'Strengthen and lengthen through controlled split-stance work, mobility, and full-range hip extension.', 'high'),
        muscle('Hamstrings', ['biceps femoris', 'semitendinosus', 'semimembranosus'], 'tight', 'Load through hinges and single-leg hinges while restoring length under control.', 'medium'),
        muscle('Adductors', ['adductor magnus', 'adductor longus'], 'tight', 'Mobilise and strengthen with lateral and split-stance patterns.', 'medium'),
        muscle('Core', ['transverse abdominis', 'obliques'], 'weak', 'Build anti-extension, anti-rotation, and bracing capacity before heavier compounds.', 'high'),
      ],
    });
  }

  if (hasAny(raw, ['shoulder', 'overhead', 'rotator', 'scap', 'neck', 'thoracic', 'lat', 'press'])) {
    issues.push({
      issue: 'Shoulder and scapular control',
      symptom_location: 'shoulders, thoracic spine, and upper body pressing',
      root_cause: 'Likely reduced scapular stability and thoracic mobility, with overhead work needing a slower entry point.',
      muscles: [
        muscle('Rotator cuff', ['supraspinatus', 'infraspinatus', 'teres minor', 'subscapularis'], 'weak', 'Strengthen with controlled external rotation, carries, and stable pressing progressions.', 'high'),
        muscle('Scapular stabilisers', ['serratus anterior', 'lower traps', 'rhomboids'], 'weak', 'Strengthen upward rotation, retraction, and protraction control.', 'high'),
        muscle('Thoracic extensors', ['thoracic erectors'], 'tight', 'Mobilise extension and rotation before demanding overhead ranges.', 'medium'),
        muscle('Lats', ['latissimus dorsi'], 'tight', 'Restore shoulder flexion range while strengthening pulling patterns.', 'medium'),
      ],
    });
  }

  if (hasAny(raw, ['knee', 'patella', 'acl', 'meniscus', 'lunge', 'step up'])) {
    issues.push({
      issue: 'Knee tracking and lower-body load tolerance',
      symptom_location: 'knees and single-leg patterns',
      root_cause: 'Likely glute and quad capacity gap affecting knee tracking and load tolerance.',
      muscles: [
        muscle('Quadriceps', ['vastus medialis', 'vastus lateralis', 'rectus femoris'], 'weak', 'Strengthen with squat, split squat, step-up, and controlled knee-dominant patterns.', 'high'),
        muscle('Glutes', ['glute max', 'glute med'], 'weak', 'Improve hip control to support knee alignment.', 'high'),
        muscle('Calves', ['gastrocnemius', 'soleus'], 'weak', 'Build ankle stiffness and lower-leg capacity for gait and lower-body training.', 'medium'),
      ],
    });
  }

  if (issues.length === 0) {
    issues.push({
      issue: 'General strength foundation',
      symptom_location: 'whole body',
      root_cause: 'No specific movement screen findings were available, so the safe starting point is general strength, trunk control, and mobility readiness.',
      muscles: [
        muscle('Glutes', ['glute max', 'glute med'], 'weak', 'Strengthen with squats, hinges, bridges, lunges, and unilateral progressions.', 'high'),
        muscle('Core', ['transverse abdominis', 'obliques'], 'weak', 'Build bracing, anti-rotation, and anti-extension capacity.', 'high'),
        muscle('Thoracic spine', ['thoracic extensors'], 'tight', 'Maintain mobility for pressing, pulling, and squat mechanics.', 'medium'),
      ],
    });
  }

  const needsMobility = hasAny(raw, ['tight', 'stiff', 'mobility', 'range of motion', 'pain', 'injury', 'restriction']);
  const needsCardio = hasAny(raw, ['fat loss', 'weight loss', 'conditioning', 'cardio', 'body composition']);
  const avoidOverhead = hasAny(raw, ['shoulder', 'overhead', 'impingement', 'rotator']);
  const posterior = hasAny(raw, ['glute', 'hamstring', 'hip', 'lower back', 'low back', 'deadlift', 'hinge']);
  const injuryCount = ['shoulder', 'knee', 'back', 'hip', 'ankle', 'neck'].filter((keyword) => raw.includes(keyword)).length;

  return {
    client_id: ctx.clientId,
    primary_issues: issues,
    secondary_findings: [
      needsMobility ? 'Mobility work should sit inside the warm-up and accessory slots.' : 'No major mobility restriction found in fallback scan.',
      'Fallback mind map used because model analysis was unavailable.',
    ],
    overall_level: hasAny(raw, ['advanced', '3 years', 'barbell', 'powerlifting', 'olympic']) ? 'advanced' : hasAny(raw, ['beginner', 'new to training', 'not trained']) ? 'beginner' : 'intermediate',
    compound_readiness: injuryCount > 1 || avoidOverhead ? 'medium' : 'high',
    severity: injuryCount > 2 ? 'severe' : injuryCount > 0 || needsMobility ? 'moderate' : 'mild',
    programme_flags: {
      avoid_overhead_pressing_initially: avoidOverhead,
      prioritise_posterior_chain: posterior,
      needs_mobility_block: needsMobility,
      needs_cardio_block: needsCardio,
    },
    fallback_used: true,
  };
}

function muscle(
  name: string,
  specificMuscles: string[],
  status: 'weak' | 'tight',
  treatment: string,
  priority: 'high' | 'medium' | 'low',
): Record<string, unknown> {
  return { name, specific_muscles: specificMuscles, status, treatment, priority };
}

function hasAny(raw: string, keywords: string[]): boolean {
  return keywords.some((keyword) => raw.includes(keyword));
}
