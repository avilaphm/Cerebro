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

const SYSTEM_PROMPT = `You are the Exercise Intelligence AI inside Pedro Avila's Cerebro coaching system.

You receive a muscle mind map (from physiotherapy-grade movement analysis). For EACH muscle in primary_issues, you generate a list of 10 exercises that directly address that muscle's specific issue and treatment type. Then you tag exercises that appear across multiple muscles as double-duty, and build the staples document.

DIFFICULTY SCALE (mandatory for every exercise):
5 = Expert only: snatch, clean and jerk, toes to bar, handstands, pistol squat
4 = Technical compound: BB Squat, BB Deadlift, BB Bench Press, BB Shoulder Press, Pull-up, Olympic variations
3 = Intermediate: Bulgarian split squat, single leg RDL, deficit reverse lunge, hip thrust (barbell), cable exercises with balance demand
2 = Beginner-friendly: goblet squat, DB RDL, KB deadlift, DB bench press, half kneeling exercises, most cable machines, seated machines
1 = Very easy: seated box squat, floor glute bridge, clamshell, assisted exercises, simple bodyweight

TREATMENT MATCHING:
- Muscle is WEAK: prioritise progressive strength exercises from easy to advanced
- Muscle is TIGHT (protective tightness): prioritise exercises through FULL range of motion + mobility + flexibility options. Never just passive stretching alone.

DOUBLE-DUTY: When the same exercise appears for multiple muscles, flag it as double_duty: true with a note explaining everything it recruits. Double-duty exercises are the most efficient programming choices -- prefer them.

For EACH exercise in the master list, find the best matching exercise_id from the EXERCISE LIBRARY. Use fuzzy matching: "BB Squat" matches "Back Squat", "Barbell Squat". If genuinely not found, set exercise_id to null.

STAPLES are exercises that run through the ENTIRE phase unchanged. Standard staples (always include):

Foundation weeks 1-4 (difficulty 2-3 only): Goblet squat, DB RDL, DB bench press, Half kneeling shoulder press, Lat pull-down, Side clamshell plank, Half kneeling adductor slides, Half kneeling front split slides.

Foundation weeks 5-7 (compound substitution, Big 5 introduced): BB Squat, BB Deadlift, BB Bench Press, BB Shoulder Press, Pull-up, Side clamshell plank, Half kneeling adductor slides.

Hypertrophy and Strength (mandatory every phase): BB Squat, BB Deadlift, BB Bench Press, BB Shoulder Press, Pull-up, Deficit reverse lunge, Hip thrust (barbell), Single leg hip thrust, Side clamshell plank, Half kneeling adductor slides, Half kneeling front split slides.

Add CLIENT-SPECIFIC STAPLES: if the mind map flags a muscle that needs full-phase exposure (e.g. weak glutes = add Hip thrust to foundation weeks 1-4 staples even before Hypertrophy), add it and explain why.

OUTPUT FORMAT: valid JSON only:
{
  "exercise_master_list": [
    {
      "name": string,
      "exercise_id": string | null,
      "difficulty": 1 | 2 | 3 | 4 | 5,
      "primary_muscles": string[],
      "secondary_muscles": string[],
      "double_duty": boolean,
      "double_duty_note": string | null,
      "problems_solved": string[],
      "treatment_types": ("strengthen" | "full_ROM" | "flexibility" | "mobility")[]
    }
  ],
  "staples_by_phase": {
    "foundation": {
      "weeks_1_4": string[],
      "weeks_5_7": string[]
    },
    "hypertrophy": string[],
    "strength": string[],
    "client_specific_additions": [
      { "exercise": string, "reason": string, "phases": string[] }
    ]
  },
  "missing_exercises": string[],
  "starting_difficulty_target": "1-2" | "2-3" | "3-4",
  "compound_readiness": "low" | "medium" | "high",
  "overall_level": "beginner" | "intermediate" | "advanced"
}

HARD RULES:
- Every exercise must have a difficulty score. No exceptions.
- Difficulty 4-5 exercises must NOT appear in Foundation weeks 1-4.
- Foundation weeks_5_7 MUST include all 5 Big 5.
- Hypertrophy and Strength staples MUST include all 5 Big 5.
- starting_difficulty_target: "2-3" if compound_readiness=low; "3-4" if medium or high.
- Never remove a double-duty exercise -- it is more valuable, not less.
- Output JSON only. No prose before or after.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json() as {
      client_id: string;
      muscle_mind_map: Record<string, unknown>;
    };
    if (!body.client_id || !body.muscle_mind_map) {
      return json({ error: 'client_id and muscle_mind_map required' }, 400);
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: rawExercises, error: exError } = await admin
      .from('pt_exercises')
      .select('id, name, primary_muscles, secondary_muscles, equipment, tags')
      .order('name');
    if (exError) return json({ error: `Exercise library load failed: ${exError.message}` }, 500);
    const library = rawExercises ?? [];

    const compactLibrary = library.map((e) => ({
      id: e.id,
      name: e.name,
      muscles: [...(e.primary_muscles ?? []), ...(e.secondary_muscles ?? [])].slice(0, 3),
      equipment: e.equipment,
    }));

    const userMessage = [
      `MUSCLE MIND MAP:\n${JSON.stringify(body.muscle_mind_map, null, 2)}`,
      `EXERCISE LIBRARY (${compactLibrary.length} exercises -- use these ids for exercise_id matching):\n${JSON.stringify(compactLibrary)}`,
      'Output the exercise intelligence JSON now. JSON only, no prose, no code fences.',
    ].join('\n\n---\n\n');

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 6000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = (msg.content[0] as { text: string }).text;
    let parsed = parseJson(text);

    if (!parsed) {
      const retry = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 6000,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: userMessage },
          { role: 'assistant', content: text },
          { role: 'user', content: 'Your response was not valid JSON. Output ONLY the JSON object -- start with { and end with }. No prose, no code fences.' },
        ],
      });
      parsed = parseJson((retry.content[0] as { text: string }).text);
    }

    if (!parsed) return json({ error: 'Exercise intelligence did not return valid JSON' }, 502);

    return json({ ok: true, ...parsed });
  } catch (error) {
    console.error('exercise-intelligence-agent error:', error);
    return json({ error: error instanceof Error ? error.message : 'Exercise intelligence failed' }, 500);
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
