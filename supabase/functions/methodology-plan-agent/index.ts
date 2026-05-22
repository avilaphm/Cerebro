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
type DaysPerWeek = 3 | 4 | 5;

interface WeekBlock { weeks: number; sets: string; weight_pct?: string; }

// Foundation: linear set climb, no deload (the whole phase is the onramp).
const FOUNDATION_CANONICAL: WeekBlock[] = [
  { sets: '2', weeks: 2 },
  { sets: '3', weeks: 3 },
  { sets: '3', weeks: 2 },
];
const FOUNDATION_TOTAL = 7;

// Hypertrophy and Strength: Eric Helms (M&S Pyramid 2nd ed) mesocycle model.
// 3 build weeks + 1 deload week per meso. Helms recommends deload every 3rd
// meso minimum; deloading every meso is safer for the Cerebro client profile.
// %1RM is the load floor/ceiling within the hypertrophy / strength zone; RPE
// drives day-to-day. "Intensity is primarily guided by repetition range and
// proximity to failure, rather than by a percentage of 1RM." - Helms 2nd ed.
interface MesoBlock { label: 'build1' | 'build2' | 'peak' | 'deload'; sets: string; weight_pct: string; }

const HYPERTROPHY_MESOS: MesoBlock[][] = [
  [
    { label: 'build1', sets: '3', weight_pct: '65%' },
    { label: 'build2', sets: '4', weight_pct: '70%' },
    { label: 'peak', sets: '4', weight_pct: '75%' },
    { label: 'deload', sets: '2', weight_pct: '60%' },
  ],
  [
    { label: 'build1', sets: '4', weight_pct: '67.5%' },
    { label: 'build2', sets: '4', weight_pct: '72.5%' },
    { label: 'peak', sets: '5', weight_pct: '77.5%' },
    { label: 'deload', sets: '2', weight_pct: '62.5%' },
  ],
  [
    { label: 'build1', sets: '4', weight_pct: '70%' },
    { label: 'build2', sets: '5', weight_pct: '75%' },
    { label: 'peak', sets: '5', weight_pct: '80%' },
    { label: 'deload', sets: '3', weight_pct: '65%' },
  ],
];

const STRENGTH_MESOS: MesoBlock[][] = [
  [
    { label: 'build1', sets: '4', weight_pct: '77%' },
    { label: 'build2', sets: '4', weight_pct: '82%' },
    { label: 'peak', sets: '5', weight_pct: '87%' },
    { label: 'deload', sets: '2', weight_pct: '70%' },
  ],
  [
    { label: 'build1', sets: '5', weight_pct: '80%' },
    { label: 'build2', sets: '5', weight_pct: '85%' },
    { label: 'peak', sets: '6', weight_pct: '90%' },
    { label: 'deload', sets: '2', weight_pct: '72%' },
  ],
  [
    { label: 'build1', sets: '5', weight_pct: '82%' },
    { label: 'build2', sets: '6', weight_pct: '88%' },
    { label: 'peak', sets: '6', weight_pct: '92%' },
    { label: 'deload', sets: '3', weight_pct: '72%' },
  ],
];

function scaleBlocks(kind: PhaseKind, targetWeeks: number): WeekBlock[] {
  const target = Math.max(1, Math.round(targetWeeks));
  if (kind === 'foundation') return scaleFoundation(target);
  const mesos = kind === 'hypertrophy' ? HYPERTROPHY_MESOS : STRENGTH_MESOS;
  return scaleMesoBased(mesos, target);
}

function scaleFoundation(target: number): WeekBlock[] {
  if (target === FOUNDATION_TOTAL) return FOUNDATION_CANONICAL.map((b) => ({ ...b }));
  if (target < FOUNDATION_CANONICAL.length) {
    return FOUNDATION_CANONICAL.slice(0, target).map((b) => ({ ...b, weeks: 1 }));
  }
  const ratios = FOUNDATION_CANONICAL.map((b) => b.weeks / FOUNDATION_TOTAL);
  const alloc = ratios.map((r) => Math.max(1, Math.round(r * target)));
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
  return FOUNDATION_CANONICAL.map((b, i) => ({ sets: b.sets, weeks: alloc[i] }));
}

function scaleMesoBased(mesos: MesoBlock[][], target: number): WeekBlock[] {
  const blocks: WeekBlock[] = [];
  let weeksUsed = 0;
  let mesoIdx = 0;
  while (weeksUsed < target) {
    const meso = mesos[Math.min(mesoIdx, mesos.length - 1)];
    const remaining = target - weeksUsed;
    if (remaining >= 4) {
      for (const b of meso) blocks.push({ sets: b.sets, weight_pct: b.weight_pct, weeks: 1 });
      weeksUsed += 4;
    } else if (remaining === 3) {
      blocks.push({ sets: meso[0].sets, weight_pct: meso[0].weight_pct, weeks: 1 });
      blocks.push({ sets: meso[1].sets, weight_pct: meso[1].weight_pct, weeks: 1 });
      blocks.push({ sets: meso[3].sets, weight_pct: meso[3].weight_pct, weeks: 1 });
      weeksUsed = target;
    } else if (remaining === 2) {
      blocks.push({ sets: meso[0].sets, weight_pct: meso[0].weight_pct, weeks: 1 });
      blocks.push({ sets: meso[3].sets, weight_pct: meso[3].weight_pct, weeks: 1 });
      weeksUsed = target;
    } else {
      blocks.push({ sets: meso[0].sets, weight_pct: meso[0].weight_pct, weeks: 1 });
      weeksUsed = target;
    }
    mesoIdx += 1;
  }
  return blocks;
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
      days_per_week?: DaysPerWeek;
      run_id?: string;
    };
    if (!body.client_analysis || !body.phase_weeks) return json({ error: 'client_analysis and phase_weeks required' }, 400);

    // Foundation is always 3 full-body days. Hypertrophy/Strength honor the coach's choice (3/4/5).
    const daysPerWeek: DaysPerWeek = body.days_per_week === 4 || body.days_per_week === 5 ? body.days_per_week : 3;

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
    // Run all RAG lookups in parallel with a per-call 15s timeout.
    const ragResults = await Promise.allSettled(
      queries.map(async (q) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15_000);
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/retrieve-knowledge-context`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...q, run_id: body.run_id ?? null }),
            signal: ctrl.signal,
          });
          if (!res.ok) return null;
          return await res.json() as RetrievalResult;
        } catch { return null; } finally { clearTimeout(timer); }
      })
    );
    for (const r of ragResults) {
      if (r.status === 'fulfilled' && r.value) {
        (r.value.relevant_excerpts ?? []).slice(0, 4).forEach((e) => excerpts.push(e));
        (r.value.referenced_documents ?? []).forEach((d) => referenced.add(d.title));
      }
    }

    const userMessage = [
      `CLIENT ANALYSIS:\n${JSON.stringify(body.client_analysis, null, 2)}`,
      `PHASE WEEKS (chosen by coach):\n${JSON.stringify(body.phase_weeks, null, 2)}`,
      `DAYS PER WEEK (chosen by coach, applies to Hypertrophy and Strength; Foundation is always 3):\n${daysPerWeek}`,
      `SCALED WEEK BLOCKS (use these - do not modify; built from Helms M&S Pyramid 2nd ed mesocycle model: 3 build + 1 deload per meso):\n${JSON.stringify({ foundation: foundationBlocks, hypertrophy: hypertrophyBlocks, strength: strengthBlocks }, null, 2)}`,
      `KNOWLEDGE BASE EXCERPTS:\n${excerpts.map((e, i) => `[${i + 1}] (${e.document_title}, sim=${e.similarity.toFixed(2)})\n${e.chunk_text}`).join('\n\n')}`,
      `DOCUMENTS REFERENCED:\n${Array.from(referenced).join(', ')}`,
      'Output the MethodologyPlan JSON now. JSON only. For Foundation set days_per_week=3, for Hypertrophy and Strength set days_per_week to the chosen value above.',
    ].join('\n\n---\n\n');

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
    const plan = parseJson(text);
    if (!plan) return json({ error: 'Methodology plan did not return valid JSON', raw: text }, 502);

    return json({ ok: true, methodology_plan: plan, cited_documents: Array.from(referenced) });
  } catch (error) {
    console.error('methodology-plan-agent error:', error);
    return json({ error: error instanceof Error ? error.message : 'Methodology planning failed' }, 500);
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
