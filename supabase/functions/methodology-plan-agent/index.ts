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

type PhaseKind = 'foundation' | 'hypertrophy' | 'strength';

interface WeekBlock { weeks: number; sets: string; weight_pct?: string; }

const CANONICAL: Record<PhaseKind, WeekBlock[]> = {
  foundation: [
    { sets: '2', weeks: 2 },
    { sets: '3', weeks: 3 },
    { sets: '3', weeks: 2 },
  ],
  hypertrophy: [
    { sets: '3', weight_pct: '65%', weeks: 3 },
    { sets: '4', weight_pct: '68%', weeks: 3 },
    { sets: '4', weight_pct: '72%', weeks: 3 },
    { sets: '5', weight_pct: '75%', weeks: 3 },
  ],
  strength: [
    { sets: '4', weight_pct: '77%', weeks: 2 },
    { sets: '4', weight_pct: '80%', weeks: 3 },
    { sets: '5', weight_pct: '85%', weeks: 3 },
    { sets: '6', weight_pct: '88%', weeks: 2 },
  ],
};

const CANONICAL_TOTAL: Record<PhaseKind, number> = { foundation: 7, hypertrophy: 12, strength: 10 };

function scaleBlocks(kind: PhaseKind, targetWeeks: number): WeekBlock[] {
  const target = Math.max(1, Math.round(targetWeeks));
  const canonical = CANONICAL[kind];
  const total = CANONICAL_TOTAL[kind];
  if (target === total) return canonical.map((b) => ({ ...b }));
  if (target < canonical.length) {
    const trimmed = canonical.slice(0, target);
    return trimmed.map((b) => ({ ...b, weeks: 1 }));
  }
  const ratios = canonical.map((b) => b.weeks / total);
  let alloc = ratios.map((r) => Math.max(1, Math.round(r * target)));
  let diff = alloc.reduce((a, b) => a + b, 0) - target;
  while (diff > 0) {
    const idx = alloc.reduce((best, w, i) => (w > alloc[best] ? i : best), 0);
    if (alloc[idx] <= 1) break;
    alloc[idx] -= 1; diff -= 1;
  }
  while (diff < 0) {
    const idx = alloc.reduce((best, w, i) => (w < alloc[best] ? i : best), 0);
    alloc[idx] += 1; diff += 1;
  }
  return canonical.map((b, i) => ({ ...b, weeks: alloc[i] })).filter((b) => b.weeks > 0);
}

const SYSTEM_PROMPT = `You are the Methodology Plan AI inside Pedro Avila's Cerebro programming system.
You receive: (1) a Client Analysis JSON describing the client; (2) the chosen number of weeks per phase;
(3) retrieved excerpts from Cerebro's 19-document knowledge base (Helms pyramids, ACSM, Precision Nutrition,
shoulder/rotator-cuff papers, Pedro's coaching philosophy, etc).

Your job: emit a MethodologyPlan JSON that the Programme Synthesis AI will use to populate every phase.

OUTPUT FORMAT — valid JSON only:
{
  "phases": [
    {
      "type": "foundation",
      "weeks": number,
      "days_per_week": 3,
      "week_blocks": [{ "weeks": number, "sets": string, "weight_pct"?: string }],
      "substitution_rule": {
        "from_week": number,
        "swaps": [
          { "from_pattern": "goblet squat", "to": "BB Squat" },
          { "from_pattern": "kb deadlift|db deadlift|dumbbell deadlift|kettlebell deadlift", "to": "BB Deadlift" },
          { "from_pattern": "db bench|dumbbell bench", "to": "BB Bench Press" },
          { "from_pattern": "lat pull[- ]?down", "to": "Pull-up" },
          { "from_pattern": "db shoulder press|dumbbell shoulder press", "to": "BB Shoulder Press" }
        ]
      },
      "warmup_count": 4,
      "main_count": 6,
      "superset_count": 3,
      "cardio_block_minutes": number | null,
      "mobility_block_minutes": number | null,
      "coaching_notes": string
    },
    { "type": "1rm_test", "weeks": 1, "sets_per_lift": "5", "lifts": ["BB Squat","BB Deadlift","BB Bench Press","BB Shoulder Press","Pull-up"], "coaching_notes": string },
    { "type": "hypertrophy", "weeks": number, "days_per_week": 3, "week_blocks": [...], "must_include_big5": true, "other_exercises_after_big5": true, "warmup_count": 4, "main_count": 6, "superset_count": 3, "cardio_block_minutes": number|null, "mobility_block_minutes": number|null, "coaching_notes": string },
    { "type": "strength", "weeks": number, "days_per_week": 3, "week_blocks": [...], "must_include_big5": true, "other_exercises_after_big5": true, "warmup_count": 4, "main_count": 6, "superset_count": 3, "cardio_block_minutes": number|null, "mobility_block_minutes": number|null, "coaching_notes": string },
    { "type": "1rm_retest", "weeks": 1, "sets_per_lift": "5", "lifts": ["BB Squat","BB Deadlift","BB Bench Press","BB Shoulder Press","Pull-up"], "coaching_notes": string }
  ],
  "cited_documents": string[]
}

RULES (NON-NEGOTIABLE):
- Foundation: exactly 3 full-body days, week_blocks as provided by the scaler, substitution_rule.from_week = (foundation_total_weeks - 1).
- Hypertrophy & Strength: must_include_big5 = true, other_exercises_after_big5 = true.
- cardio_block_minutes = 15-20 if ClientAnalysis.emphasis.needs_cardio_block, else null.
- mobility_block_minutes = 10-15 if ClientAnalysis.emphasis.needs_mobility_block, else null.
- Use the week_blocks I provide you (already scaled). Do not invent new percentages.
- coaching_notes: 2-3 sentences citing the actual document names from the knowledge excerpts.
- cited_documents: list every document name that informed any decision.`;

interface RetrievalExcerpt { document_title: string; chunk_text: string; similarity: number; }
interface RetrievalResult { relevant_excerpts?: RetrievalExcerpt[]; referenced_documents?: { title: string }[]; }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json() as {
      client_analysis: Record<string, unknown>;
      phase_weeks: { foundation: number; hypertrophy: number; strength: number };
      run_id?: string;
    };
    if (!body.client_analysis || !body.phase_weeks) return json({ error: 'client_analysis and phase_weeks required' }, 400);

    const foundationBlocks = scaleBlocks('foundation', body.phase_weeks.foundation);
    const hypertrophyBlocks = scaleBlocks('hypertrophy', body.phase_weeks.hypertrophy);
    const strengthBlocks = scaleBlocks('strength', body.phase_weeks.strength);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const queries: { task_type: string; phase_type?: string; question_or_decision: string }[] = [
      { task_type: 'foundations', phase_type: 'foundation', question_or_decision: 'Phase 1 Foundations rules and Pedro coaching philosophy for new clients' },
      { task_type: 'hypertrophy', phase_type: 'hypertrophy', question_or_decision: 'Hypertrophy phase percentage progression and rep ranges from Helms training pyramid' },
      { task_type: 'strength', phase_type: 'strength', question_or_decision: 'Strength phase percentage progression and set/rep prescription' },
      { task_type: 'testing', phase_type: '1rm_test', question_or_decision: '1RM testing protocol for the Big 5 lifts' },
      { task_type: 'warmup', question_or_decision: 'Warm-up structure: 4 exercises, 1 set, 10-12 reps' },
    ];

    const excerpts: RetrievalExcerpt[] = [];
    const referenced = new Set<string>();
    for (const q of queries) {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/retrieve-knowledge-context`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...q, run_id: body.run_id ?? null }),
        });
        if (!res.ok) continue;
        const data = await res.json() as RetrievalResult;
        (data.relevant_excerpts ?? []).slice(0, 4).forEach((e) => excerpts.push(e));
        (data.referenced_documents ?? []).forEach((d) => referenced.add(d.title));
      } catch (e) {
        console.warn('retrieve-knowledge-context call failed:', e);
      }
    }

    const userMessage = [
      `CLIENT ANALYSIS:\n${JSON.stringify(body.client_analysis, null, 2)}`,
      `PHASE WEEKS (chosen by coach):\n${JSON.stringify(body.phase_weeks, null, 2)}`,
      `SCALED WEEK BLOCKS (use these — do not modify):\n${JSON.stringify({ foundation: foundationBlocks, hypertrophy: hypertrophyBlocks, strength: strengthBlocks }, null, 2)}`,
      `KNOWLEDGE BASE EXCERPTS:\n${excerpts.map((e, i) => `[${i + 1}] (${e.document_title}, sim=${e.similarity.toFixed(2)})\n${e.chunk_text}`).join('\n\n')}`,
      `DOCUMENTS REFERENCED:\n${Array.from(referenced).join(', ')}`,
      'Output the MethodologyPlan JSON now. JSON only.',
    ].join('\n\n---\n\n');

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = (msg.content[0] as { text: string }).text;
    const plan = parseJson(text);
    if (!plan) return json({ error: 'Methodology plan did not return valid JSON', raw: text }, 502);

    return json({ ok: true, methodology_plan: plan, cited_documents: Array.from(referenced) });
  } catch (error) {
    console.error('methodology-plan-agent error:', error);
    return json({ error: error instanceof Error ? error.message : 'Methodology planning failed' }, 500);
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
