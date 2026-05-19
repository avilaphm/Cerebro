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

interface ExerciseRow {
  id: string;
  name: string;
  muscles: string[];
  primary_muscles: string[];
  secondary_muscles: string[];
  purpose: string | null;
  equipment: string | null;
  video_url: string | null;
  cues: string[];
  setup_cues: string[];
  tags: string[];
  conditions: string[];
}

const SYSTEM_PROMPT = `You are the Programme Synthesis AI inside Pedro Avila's Cerebro coaching system.

You receive:
  (1) A ClientAnalysis JSON — who the client is, their goals, constraints, preferences, emphasis flags.
  (2) A MethodologyPlan JSON — the phase structures, week_blocks (already scaled to chosen weeks), substitution rules, Big 5 requirements, cardio/mobility flags.
  (3) The Cerebro EXERCISE LIBRARY — every exercise has an id, name, video_url, cues, muscles, equipment.

Your job: produce a fully-populated PTProgramme JSON with every phase, every day, every exercise.

OUTPUT FORMAT — valid JSON only, matching this exact shape:
{
  "name": string,                                  // programme name, short
  "goal": string,                                  // 1-sentence client goal
  "programme": {
    "phases": [
      {
        "id": string,                              // generate unique slug per phase
        "title": string,                           // e.g. "Phase 1 - Foundation"
        "focus": string,                           // 1-line focus statement
        "weeks": string,                           // total weeks, as string
        "progression": string,                     // 1-2 sentences about how it progresses
        "week_blocks": [{ "weeks": number, "sets": string, "weight_pct"?: string }],
        "days": [
          {
            "id": string,                          // unique slug per day
            "title": string,                       // e.g. "Day 1 - Full Body A"
            "focus": string,
            "exercises": [
              {
                "id": string,                      // unique slug per exercise instance
                "exercise_id": string,             // MUST be a real id from the EXERCISE LIBRARY
                "name": string,                    // exact name from the library
                "sets": string,                    // sets for this exercise (typically matches week_blocks[0].sets)
                "reps": string,                    // rep range e.g. "8-12" or "10-12"
                "rest": string,                    // e.g. "60 sec" or "2 min"
                "notes": string,                   // 1 short tempo/intent cue
                "section_start": "Warm Up" | "Workout" | "MetCon" | "Stretches" | null,
                "superset_id": string | null,      // group exercises that pair
                "video_url": null,                 // leave null — server attaches from library
                "cues": []                          // leave empty array — server attaches from library
              }
            ]
          }
        ]
      }
    ]
  },
  "missing_exercises": string[]                    // names of exercises you wanted but couldn't find in the library
}

HARD RULES (violating any = failure):

1. EVERY exercise.exercise_id MUST be a real id from the EXERCISE LIBRARY. If you can't find a suitable exercise,
   add the desired name to "missing_exercises" and skip — do NOT invent an exercise_id.

2. FOUNDATION PHASE: exactly 3 full-body days. Day 1, Day 2, Day 3 are different workouts but cover the full body.
   - All 3 days share the same exercise list across week_blocks (set count varies per block, but exercises stay).
   - In the LAST week block (substitution_rule.from_week onward), swap simpler movements to the Big 5:
     goblet squat → BB Squat, KB/DB deadlift → BB Deadlift, DB bench → BB Bench Press,
     lat pull-down → Pull-up, DB shoulder press → BB Shoulder Press.
     Encode the swap as a NEW exercise in the same slot (with a Big 5 exercise_id) and record the swap intent
     in the day's exercises array. For the substitution week, output the swapped exercise list.

3. HYPERTROPHY & STRENGTH PHASES: Every workout day MUST include ALL 5 Big 5 lifts in this order at the top:
   BB Squat, BB Deadlift, BB Bench Press, BB Shoulder Press, Pull-up.
   Each Big 5 exercise.sets MUST equal week_blocks[0].sets.
   Each Big 5 exercise.notes must include "% of 1RM as per week block".
   AFTER the Big 5, sprinkle in 1-3 accessory exercises chosen from the library that match client constraints.

4. WARM-UP: every workout day starts with exactly 4 warm-up exercises (section_start "Warm Up" on the first).
   Each warm-up: 1 set, 10-12 reps, low-intensity, prep for that day's main lifts.

5. WORKOUT BLOCK: 6 main exercises in 3 supersets (section_start "Workout" on the first main exercise).
   Use superset_id to pair exercises (e.g. "ss-1" for exercises 1 and 2, "ss-2" for 3 and 4, "ss-3" for 5 and 6).
   For Hypertrophy/Strength phases, the Big 5 occupy slots; other exercises are accessory.

6. CARDIO BLOCK: if MethodologyPlan phase.cardio_block_minutes is not null, add a single cardio exercise at end
   (section_start "MetCon") with sets="1", reps="<minutes> min steady" (substitute the actual number),
   exercise_id from library (bike, rower, treadmill, etc.).

7. MOBILITY BLOCK: if MethodologyPlan phase.mobility_block_minutes is not null, add 2-3 mobility/stretching
   exercises at end (section_start "Stretches"), 1 set each, 30-60 sec hold.

8. 1RM TEST / RETEST: ONE workout day containing only the 5 Big 5, sets="5" each, reps="1", rest="3-5 min".
   Phase weeks = 1. No warm-up section needed inside the exercises array (the 1RM warm-up ramp is on the client side).

9. EXERCISE SELECTION must honor ClientAnalysis.constraints (avoid contraindicated exercises) and
   ClientAnalysis.preferences (favor likes, avoid dislikes when possible).

10. id fields: use kebab-case slugs unique within their parent (e.g. "phase-foundation", "day-1", "ex-bb-squat-1").`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json() as {
      client_analysis: Record<string, unknown>;
      methodology_plan: Record<string, unknown>;
    };
    if (!body.client_analysis || !body.methodology_plan) {
      return json({ error: 'client_analysis and methodology_plan required' }, 400);
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: rawExercises, error: exError } = await admin
      .from('pt_exercises')
      .select('id, name, muscles, primary_muscles, secondary_muscles, purpose, equipment, video_url, cues, setup_cues, tags, conditions')
      .order('name');
    if (exError) return json({ error: `Exercise library load failed: ${exError.message}` }, 500);
    const library: ExerciseRow[] = rawExercises ?? [];
    if (library.length === 0) return json({ error: 'Exercise library is empty' }, 500);

    const compactLibrary = library.map((e) => ({
      id: e.id,
      name: e.name,
      muscles: [...(e.primary_muscles ?? []), ...(e.secondary_muscles ?? []), ...(e.muscles ?? [])].slice(0, 6),
      equipment: e.equipment,
      tags: (e.tags ?? []).slice(0, 4),
      conditions: e.conditions ?? [],
    }));

    const userMessage = [
      `CLIENT ANALYSIS:\n${JSON.stringify(body.client_analysis, null, 2)}`,
      `METHODOLOGY PLAN:\n${JSON.stringify(body.methodology_plan, null, 2)}`,
      `EXERCISE LIBRARY (${compactLibrary.length} exercises):\n${JSON.stringify(compactLibrary)}`,
      'Output the full PTProgramme JSON now. JSON only — no prose.',
    ].join('\n\n---\n\n');

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = (msg.content[0] as { text: string }).text;
    const parsed = parseJson(text);
    if (!parsed) return json({ error: 'Programme synthesis did not return valid JSON', raw: text }, 502);

    const enriched = enrichProgramme(parsed, library);

    return json({ ok: true, ...enriched });
  } catch (error) {
    console.error('programme-synthesis-agent error:', error);
    return json({ error: error instanceof Error ? error.message : 'Synthesis failed' }, 500);
  }
});

function enrichProgramme(parsed: Record<string, unknown>, library: ExerciseRow[]): Record<string, unknown> {
  const byId = new Map<string, ExerciseRow>(library.map((e) => [e.id, e]));
  const byNameNorm = new Map<string, ExerciseRow>(library.map((e) => [e.name.toLowerCase().trim(), e]));

  const programme = parsed.programme as { phases?: Array<Record<string, unknown>> } | undefined;
  const phases = programme?.phases ?? [];
  const unresolved: Array<{ phase: string; day: string; name: string }> = [];

  for (const phase of phases) {
    const days = (phase.days as Array<Record<string, unknown>>) ?? [];
    for (const day of days) {
      const exercises = (day.exercises as Array<Record<string, unknown>>) ?? [];
      for (const ex of exercises) {
        let row: ExerciseRow | undefined;
        const exerciseId = ex.exercise_id as string | undefined;
        const name = (ex.name as string | undefined)?.trim() ?? '';
        if (exerciseId && byId.has(exerciseId)) {
          row = byId.get(exerciseId);
        } else if (name) {
          row = byNameNorm.get(name.toLowerCase());
        }
        if (row) {
          ex.exercise_id = row.id;
          ex.name = row.name;
          ex.video_url = row.video_url;
          ex.cues = row.cues ?? [];
        } else {
          unresolved.push({
            phase: String(phase.title ?? ''),
            day: String(day.title ?? ''),
            name: name || '(unnamed)',
          });
        }
      }
    }
  }

  const missing = (parsed.missing_exercises as string[] | undefined) ?? [];
  const allMissing = Array.from(new Set([...missing, ...unresolved.map((u) => `${u.phase} / ${u.day}: ${u.name}`)]));

  return {
    name: parsed.name ?? '',
    goal: parsed.goal ?? '',
    programme: parsed.programme ?? { phases: [] },
    missing_exercises: allMissing,
    unresolved_count: unresolved.length,
  };
}

function parseJson(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text); } catch { /* noop */ }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* noop */ } }
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a !== -1 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch { /* noop */ } }
  return null;
}
