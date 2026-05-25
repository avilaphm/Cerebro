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

Your job: produce ONE fully-populated programme phase with every day and exercise for the provided methodology phase.

OUTPUT FORMAT — valid JSON only, matching this exact shape:
{
  "name": string,                                  // only when phase_index is 0, programme name, short
  "goal": string,                                  // only when phase_index is 0, 1-sentence client goal
  "phase": {
    "id": string,                                  // generate unique slug for this phase
    "title": string,                               // e.g. "Phase 1 - Foundation"
    "focus": string,                               // 1-line focus statement
    "weeks": string,                               // total weeks, as string
    "progression": string,                         // 1-2 sentences about how it progresses
    "week_blocks": [{ "weeks": number, "sets": string, "weight_pct"?: string }],
    "days": [
      {
        "id": string,                              // unique slug per day
        "title": string,                           // e.g. "Day 1 - Full Body A"
        "focus": string,
        "exercises": [
          {
            "exercise_id": string,                 // MUST be a real id from the EXERCISE LIBRARY
            "sets": string,                        // sets for this exercise (typically matches week_blocks[0].sets)
            "reps": string,                        // rep range e.g. "8-12" or "10-12"
            "section_start": "Warm Up" | "Workout" | "MetCon" | "Stretches" | null,
            "superset_id": string | null           // group exercises that pair
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
   - Infer equipment from ClientAnalysis.constraints.equipment and cited notes. If equipment is not explicitly bands-only,
     bodyweight-only, home-only, travel-only, or no-gym, assume gym access.
   - For gym Foundation, NEVER use banded exercises. No banded deadlifts, banded hinges, banded squats, banded rows,
     banded presses, or banded lower-body substitutes. Use DB, KB, cable, machine, or bodyweight choices instead.
   - Day 1 and Day 2 must emphasize single-arm and single-leg work. Day 3 must emphasize bilateral work.
   - Every Foundation exercise note must include tempo, controlled eccentric, pause, range, or execution intent.
   - Preferred Foundation staples: Hip flexor cable pull, Standing hip flexor KB pull, Half kneeling adductor slides
     sideways/front, Single-leg glute bridge/hip thrust, Single-arm cable pull, DB push, Single-leg step-up,
     Cable crunch, Back extension, QL extension, Leg press, Knee extension, Hamstring curl, Single-leg DB RDL,
     Seated shoulder press, Hip CARs.
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

6. CARDIO BLOCK: do not output cardio exercises. The server appends them when MethodologyPlan phase.cardio_block_minutes is set.

7. MOBILITY BLOCK: do not output mobility/stretching exercises. The server appends them when MethodologyPlan phase.mobility_block_minutes is set.

8. 1RM TEST / RETEST: ONE workout day containing only the 5 Big 5, sets="5" each, reps="1", rest="3-5 min".
   Phase weeks = 1. No warm-up section needed inside the exercises array (the 1RM warm-up ramp is on the client side).

9. EXERCISE SELECTION must honor ClientAnalysis.constraints (avoid contraindicated exercises) and
   ClientAnalysis.preferences (favor likes, avoid dislikes when possible).

10. id fields: use kebab-case slugs unique within their parent (e.g. "phase-foundation", "day-1", "ex-bb-squat-1").

11. Keep output compact: focus/progression are one sentence each, no extra fields.

12. Do not include exercise name, video_url, cues, exercise instance id, rest, or notes. The server attaches those.

13. Return minified JSON only. Do not wrap it in markdown fences.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json() as {
      client_analysis: Record<string, unknown>;
      methodology_plan_phase: Record<string, unknown>;
      phase_index: number;
      programme_name?: string;
      programme_goal?: string;
      exercise_master_list?: Array<{ exercise_id: string | null; name: string; difficulty: number }>;
    };
    if (!body.client_analysis || !body.methodology_plan_phase || typeof body.phase_index !== 'number') {
      return json({ error: 'client_analysis, methodology_plan_phase, and phase_index required' }, 400);
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: rawExercises, error: exError } = await admin
      .from('pt_exercises')
      .select('id, name, muscles, primary_muscles, secondary_muscles, purpose, equipment, video_url, cues, setup_cues, tags, conditions')
      .order('name');
    if (exError) return json({ error: `Exercise library load failed: ${exError.message}` }, 500);
    const library: ExerciseRow[] = rawExercises ?? [];
    if (library.length === 0) return json({ error: 'Exercise library is empty' }, 500);

    const filtered = filterLibraryForClient(library, body.client_analysis);

    const compactLibrary = filtered.map((e) => ({
      id: e.id,
      name: e.name,
      muscles: [...(e.primary_muscles ?? []), ...(e.secondary_muscles ?? []), ...(e.muscles ?? [])].slice(0, 4),
      equipment: e.equipment,
    }));

    // Build a set of exercise IDs from the exercise master list (if provided) to prefer client-specific exercises.
    const priorityIds = new Set<string>(
      (body.exercise_master_list ?? [])
        .filter((e) => e.exercise_id !== null && e.difficulty >= 2 && e.difficulty <= 4)
        .map((e) => e.exercise_id as string),
    );

    const deterministic = buildDeterministicPhase(body.methodology_plan_phase, library, filtered, body.phase_index, body.client_analysis, priorityIds);
    if (deterministic) return json({ ok: true, ...deterministic });

    const userMessage = [
      `CLIENT ANALYSIS:\n${JSON.stringify(body.client_analysis, null, 2)}`,
      `PHASE INDEX:\n${body.phase_index}`,
      `METHODOLOGY PLAN PHASE:\n${JSON.stringify(body.methodology_plan_phase, null, 2)}`,
      `OPTIONAL PROGRAMME NAME:\n${body.programme_name ?? ''}`,
      `OPTIONAL PROGRAMME GOAL:\n${body.programme_goal ?? ''}`,
      `EXERCISE LIBRARY (${compactLibrary.length} exercises):\n${JSON.stringify(compactLibrary)}`,
      'Output this single compact phase JSON now. Minified JSON only, no prose, no markdown fence.',
    ].join('\n\n---\n\n');

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
    const claudeCtrl = new AbortController();
    const claudeTimer = setTimeout(() => claudeCtrl.abort(), 60_000);
    let text: string;
    try {
      const msg = await anthropic.messages.create(
        { model: 'claude-sonnet-4-6', max_tokens: 4500, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userMessage }] },
        { signal: claudeCtrl.signal },
      );
      text = (msg.content[0] as { text: string }).text;
    } finally { clearTimeout(claudeTimer); }
    const parsed = parseJson(text);
    if (!parsed) return json({ error: 'Programme synthesis did not return valid JSON', raw: text }, 502);

    const enriched = enrichPhase(parsed, library, body.methodology_plan_phase);

    return json({ ok: true, ...enriched });
  } catch (error) {
    console.error('programme-synthesis-agent error:', error);
    return json({ error: error instanceof Error ? error.message : 'Synthesis failed' }, 500);
  }
});

function enrichPhase(parsed: Record<string, unknown>, library: ExerciseRow[], methodologyPhase: Record<string, unknown>): Record<string, unknown> {
  const byId = new Map<string, ExerciseRow>(library.map((e) => [e.id, e]));
  const byNameNorm = new Map<string, ExerciseRow>(library.map((e) => [e.name.toLowerCase().trim(), e]));

  const phase = (parsed.phase ?? {}) as Record<string, unknown>;
  const unresolved: Array<{ phase: string; day: string; name: string }> = [];

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
        ex.id = typeof ex.id === 'string' && ex.id ? ex.id : slugExerciseId(row.name, exercises.indexOf(ex) + 1);
        ex.exercise_id = row.id;
        ex.name = row.name;
        ex.rest = typeof ex.rest === 'string' ? ex.rest : defaultRest(String(ex.section_start ?? ''));
        ex.notes = typeof ex.notes === 'string' ? ex.notes : '';
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
    appendConditionalBlocks(day, library, methodologyPhase);
  }

  const missing = (parsed.missing_exercises as string[] | undefined) ?? [];
  const allMissing = Array.from(new Set([...missing, ...unresolved.map((u) => `${u.phase} / ${u.day}: ${u.name}`)]));

  return {
    name: parsed.name ?? '',
    goal: parsed.goal ?? '',
    phase,
    missing_exercises: allMissing,
    unresolved_count: unresolved.length,
  };
}

function buildDeterministicPhase(
  methodologyPhase: Record<string, unknown>,
  library: ExerciseRow[],
  filteredLibrary: ExerciseRow[],
  phaseIndex: number,
  analysis: Record<string, unknown>,
  priorityIds: Set<string> = new Set(),
): Record<string, unknown> | null {
  const type = String(methodologyPhase.type ?? '').toLowerCase();
  const weekBlocks = (methodologyPhase.week_blocks as Array<Record<string, unknown>> | undefined) ?? [];
  const weeks = String(methodologyPhase.weeks ?? (type.includes('1rm') ? 1 : weekBlocks.reduce((sum, b) => sum + Number(b.weeks ?? 0), 0) || ''));
  const warmups = pickWarmups(filteredLibrary);
  const big5 = pickBig5(library);
  if (big5.length < 5) return null;

  if (type === '1rm_test' || type === '1rm_retest') {
    const phase = {
      id: type === '1rm_retest' ? 'phase-1rm-retest' : 'phase-1rm-test',
      title: type === '1rm_retest' ? '1RM Retest' : '1RM Test',
      focus: 'Measure baseline strength across the Big 5 lifts.',
      weeks,
      progression: 'One testing week establishes percentage-based loading for the next phase.',
      week_blocks: [],
      days: [{
        id: 'day-1',
        title: type === '1rm_retest' ? 'Day 1 - 1RM Retest' : 'Day 1 - 1RM Test',
        focus: 'Big 5 strength testing',
        exercises: big5.map((row, index) => buildExercise(row, index + 1, '5', '1', '3-5 min', '% of 1RM test', index === 0 ? 'Workout' : null, null, BIG_5_LABELS[index])),
      }],
    };
    return { name: phaseIndex === 0 ? programmeNameFromAnalysis(analysis) : '', goal: phaseIndex === 0 ? goalFromAnalysis(analysis) : '', phase, missing_exercises: [], unresolved_count: 0 };
  }

  if (type === 'hypertrophy' || type === 'strength') {
    const sets = String((weekBlocks[0]?.sets as string | undefined) ?? (type === 'hypertrophy' ? '3' : '4'));
    const repsCompound = type === 'hypertrophy' ? '8-12' : '3-6';
    const repsAccessory = type === 'hypertrophy' ? '10-15' : '6-8';
    const rest = type === 'hypertrophy' ? '60-90 sec' : '2-3 min';
    const daysPerWeek = (methodologyPhase.days_per_week === 4 || methodologyPhase.days_per_week === 5) ? methodologyPhase.days_per_week as 4 | 5 : 3;
    const big5Schedule = scheduleBig5(daysPerWeek, big5);
    const dayTitles = dayTitlesFor(type, daysPerWeek);
    const dayFocuses = dayFocusesFor(type, daysPerWeek);
    const accessoryPool = pickAccessories(filteredLibrary, big5, priorityIds);

    const days = big5Schedule.map((dayBig5, dayIndex) => {
      const big5Count = dayBig5.length;
      const accessoryTarget = Math.max(0, 6 - big5Count); // Aim for 6 exercises in Workout section
      const accessorySlots: ExerciseRow[] = [];
      for (let i = 0; i < accessoryTarget; i++) {
        const pick = accessoryPool[(dayIndex * accessoryTarget + i) % Math.max(1, accessoryPool.length)];
        if (pick && !accessorySlots.includes(pick)) accessorySlots.push(pick);
      }
      const exercises: Array<Record<string, unknown>> = [
        ...warmups.map((row, index) => buildExercise(row, index + 1, '1', '10-12', '30 sec', '', index === 0 ? 'Warm Up' : null, null)),
      ];
      dayBig5.forEach((row, i) => {
        exercises.push(buildExercise(row, exercises.length + 1, sets, repsCompound, rest, '% of 1RM as per week block', i === 0 ? 'Workout' : null, `ss-${Math.floor(i / 2) + 1}`, row.name));
      });
      accessorySlots.forEach((row, i) => {
        const supersetId = `ss-${Math.floor((big5Count + i) / 2) + 1}`;
        const sectionStart = big5Count === 0 && i === 0 ? 'Workout' : null;
        exercises.push(buildExercise(row, exercises.length + 1, sets, repsAccessory, rest, '', sectionStart, supersetId));
      });
      const day = {
        id: `day-${dayIndex + 1}`,
        title: dayTitles[dayIndex] ?? `Day ${dayIndex + 1}`,
        focus: dayFocuses[dayIndex] ?? (type === 'hypertrophy' ? 'Big 5 volume with accessory support.' : 'Big 5 strength practice with controlled accessories.'),
        exercises,
      };
      appendConditionalBlocks(day, filteredLibrary, methodologyPhase);
      return day;
    });

    const phase = {
      id: type === 'hypertrophy' ? 'phase-hypertrophy' : 'phase-strength',
      title: type === 'hypertrophy' ? 'Phase 2 - Hypertrophy' : 'Phase 3 - Strength',
      focus: type === 'hypertrophy' ? 'Build muscle and work capacity through Big 5 volume.' : 'Build force production through heavier Big 5 practice.',
      weeks,
      progression: `Helms-style mesocycle progression: 3 build weeks + 1 deload per meso, RPE drives day-to-day load within the prescribed %1RM band. Split: ${daysPerWeek === 3 ? 'full body x3' : daysPerWeek === 4 ? 'upper/lower x4' : 'lower/push/pull/lower/upper x5'}.`,
      week_blocks: weekBlocks,
      days_per_week: daysPerWeek,
      days,
    };
    return { name: phaseIndex === 0 ? programmeNameFromAnalysis(analysis) : '', goal: phaseIndex === 0 ? goalFromAnalysis(analysis) : '', phase, missing_exercises: [], unresolved_count: 0 };
  }

  if (type === 'foundation') {
    const sets = String((weekBlocks[0]?.sets as string | undefined) ?? '2');
    const isGymAccess = inferGymAccess(analysis);
    const foundationLibrary = isGymAccess ? filteredLibrary.filter((exercise) => !isBandedExercise(exercise)) : filteredLibrary;
    const foundationWarmups = pickWarmups(foundationLibrary);
    const mainPools = pickFoundationDayPools(foundationLibrary, big5, priorityIds, isGymAccess);
    const days = [0, 1, 2].map((dayIndex) => {
      const main = mainPools[dayIndex] ?? rotate(mainPools.flat(), dayIndex).slice(0, 6);
      const exercises = [
        ...foundationWarmups.map((row, index) => buildExercise(row, index + 1, '1', '10-12', '30 sec', foundationTempoNote(row, true), index === 0 ? 'Warm Up' : null, null)),
        ...main.map((row, index) => buildExercise(row, index + 5, sets, '10-12', '60 sec', foundationTempoNote(row, false), index === 0 ? 'Workout' : null, `ss-${Math.floor(index / 2) + 1}`)),
      ];
      const day = {
        id: `day-${dayIndex + 1}`,
        title: `Day ${dayIndex + 1} - ${dayIndex < 2 ? 'Unilateral' : 'Bilateral'} Foundation`,
        focus: dayIndex < 2
          ? 'Single-arm and single-leg control, movement quality, glute strength, and core control.'
          : 'Bilateral pattern confidence, controlled loading, and compound readiness.',
        exercises,
      };
      appendConditionalBlocks(day, foundationLibrary, methodologyPhase);
      return day;
    });

    const phase = {
      id: 'phase-foundation',
      title: 'Phase 1 - Foundation',
      focus: 'Build movement quality and tissue tolerance before heavy loading.',
      weeks,
      progression: 'Sets progress through the scaled week blocks, with compound readiness built in the final block.',
      week_blocks: weekBlocks,
      days,
    };
    return { name: phaseIndex === 0 ? programmeNameFromAnalysis(analysis) : '', goal: phaseIndex === 0 ? goalFromAnalysis(analysis) : '', phase, missing_exercises: [], unresolved_count: 0 };
  }

  return null;
}

function buildExercise(
  row: ExerciseRow,
  index: number,
  sets: string,
  reps: string,
  rest: string,
  notes: string,
  sectionStart: string | null,
  supersetId: string | null,
  displayName?: string,
): Record<string, unknown> {
  return {
    id: slugExerciseId(displayName ?? row.name, index),
    exercise_id: row.id,
    name: displayName ?? row.name,
    sets,
    reps,
    rest,
    notes,
    section_start: sectionStart,
    superset_id: supersetId,
    video_url: row.video_url,
    cues: row.cues ?? [],
  };
}

const BIG_5_LABELS = ['BB Squat', 'BB Deadlift', 'BB Bench Press', 'BB Shoulder Press', 'Pull-up'];

// Distribute Big 5 lifts across the training days based on chosen split.
// big5 array is in BIG_5_LABELS order: [Squat, Deadlift, Bench, OHP, Pull-up].
// Returns one ExerciseRow array per day, listing the Big 5 lifts that day.
function scheduleBig5(daysPerWeek: 3 | 4 | 5, big5: ExerciseRow[]): ExerciseRow[][] {
  const [squat, deadlift, bench, ohp, pullup] = big5;
  switch (daysPerWeek) {
    case 3:
      // Full body x3: every day has all 5 Big 5.
      return [[squat, deadlift, bench, ohp, pullup], [squat, deadlift, bench, ohp, pullup], [squat, deadlift, bench, ohp, pullup]];
    case 4:
      // Upper/Lower x4: each Big 5 lift 2x/week.
      return [
        [squat, deadlift],          // Day 1 Lower A
        [bench, ohp, pullup],       // Day 2 Upper A
        [squat, deadlift],          // Day 3 Lower B
        [bench, ohp, pullup],       // Day 4 Upper B
      ];
    case 5:
      // Lower / Push / Pull / Lower / Upper. Each Big 5 lift 2x/week.
      return [
        [squat],                    // Day 1 Lower A
        [bench, ohp],               // Day 2 Push
        [deadlift, pullup],         // Day 3 Pull
        [squat],                    // Day 4 Lower B
        [bench, ohp, pullup],       // Day 5 Upper
      ];
  }
}

function dayTitlesFor(type: 'hypertrophy' | 'strength', daysPerWeek: 3 | 4 | 5): string[] {
  const label = type === 'hypertrophy' ? 'Hypertrophy' : 'Strength';
  if (daysPerWeek === 3) return [`Day 1 - ${label} A`, `Day 2 - ${label} B`, `Day 3 - ${label} C`];
  if (daysPerWeek === 4) return [`Day 1 - Lower A (${label})`, `Day 2 - Upper A (${label})`, `Day 3 - Lower B (${label})`, `Day 4 - Upper B (${label})`];
  return [`Day 1 - Lower A (${label})`, `Day 2 - Push (${label})`, `Day 3 - Pull (${label})`, `Day 4 - Lower B (${label})`, `Day 5 - Upper (${label})`];
}

function dayFocusesFor(type: 'hypertrophy' | 'strength', daysPerWeek: 3 | 4 | 5): string[] {
  const intent = type === 'hypertrophy' ? 'Big 5 volume with accessory support' : 'Heavier Big 5 practice with controlled accessories';
  if (daysPerWeek === 3) return [intent, intent, intent];
  if (daysPerWeek === 4) return [
    'Lower body Big 5 plus posterior chain accessories.',
    'Upper body Big 5 plus pushing/pulling accessories.',
    'Lower body Big 5 plus unilateral and core accessories.',
    'Upper body Big 5 plus arm and shoulder accessories.',
  ];
  return [
    'Lower body squat focus plus quad accessories.',
    'Push focus: chest, shoulder and tricep work.',
    'Pull focus: back, posterior chain and bicep work.',
    'Lower body deadlift focus plus hamstring and glute accessories.',
    'Upper body integration day, all push/pull patterns.',
  ];
}

// Hardcoded IDs are stable DB records confirmed against the production exercise table.
// Pattern matching is unreliable: "Archer Pull-Up" matches /pull[- ]?up/ before "Pull Up";
// "DB Shoulder Press" matches /shoulder press/ before "Overhead Press".
const BIG5_ORDERED_IDS = [
  '3b551e61-9b4c-412d-82f5-a5a34c44c770', // Back Squat -> displayed as BB Squat
  '743c5231-e1e4-4d45-aee6-b7d0d3c17723', // Conventional Deadlift -> BB Deadlift
  '7baa12b2-9949-4e0c-8f72-1f7a801050fa', // Barbell Bench Press -> BB Bench Press
  'a85f183d-2b6b-47a1-b5ff-5881bb15cb3f', // Overhead Press -> BB Shoulder Press
  '4e4392c7-b6f0-4bd2-94fa-fae97e360e22', // Pull Up
] as const;

function pickBig5(library: ExerciseRow[]): ExerciseRow[] {
  const byId = new Map(library.map((e) => [e.id, e]));
  return BIG5_ORDERED_IDS.map((id) => byId.get(id)).filter((row): row is ExerciseRow => Boolean(row));
}

function pickWarmups(library: ExerciseRow[]): ExerciseRow[] {
  const patterns = [/hip cars/i, /glute bridge/i, /dead bug/i, /cat[- ]?cow|thoracic/i, /hip/i, /bodyweight squat/i];
  return pickByPatterns(library, patterns, 4);
}

function pickAccessories(library: ExerciseRow[], exclude: ExerciseRow[], priorityIds: Set<string> = new Set()): ExerciseRow[] {
  const excluded = new Set(exclude.map((e) => e.id));
  const candidates = library.filter((e) => !excluded.has(e.id) && /(row|split squat|lunge|curl|tricep|raise|pallof|plank|carry|bridge)/i.test(e.name));
  if (priorityIds.size === 0) return candidates.slice(0, 9);
  // Prefer exercises from the exercise intelligence master list first (client-specific picks).
  const priority = candidates.filter((e) => priorityIds.has(e.id));
  const rest = candidates.filter((e) => !priorityIds.has(e.id));
  return [...priority, ...rest].slice(0, 9);
}

function pickFoundationMain(library: ExerciseRow[], big5: ExerciseRow[], priorityIds: Set<string> = new Set()): ExerciseRow[] {
  const patterns = [/goblet squat/i, /deadlift/i, /bench press/i, /lat pull/i, /row/i, /split squat|lunge/i, /pallof|dead bug|plank/i, /glute/i];
  const big5Ids = new Set(big5.map((e) => e.id));
  if (priorityIds.size > 0) {
    // Prefer client-specific exercises (from exercise intelligence) that are appropriate for Foundation (not Big 5).
    const priorityFoundation = library.filter((e) => priorityIds.has(e.id) && !big5Ids.has(e.id));
    const patternPicks = pickByPatterns(library, patterns, 8);
    const combined = [...priorityFoundation, ...patternPicks.filter((e) => !priorityIds.has(e.id))];
    const deduped = Array.from(new Map(combined.map((e) => [e.id, e])).values());
    return deduped.slice(0, 8);
  }
  const picked = pickByPatterns(library, patterns, 8);
  return picked.length >= 6 ? picked : [...picked, ...big5].slice(0, 6);
}

function pickFoundationDayPools(library: ExerciseRow[], big5: ExerciseRow[], priorityIds: Set<string> = new Set(), isGymAccess = true): ExerciseRow[][] {
  const source = isGymAccess ? library.filter((exercise) => !isBandedExercise(exercise)) : library;
  const day1 = pickByPatterns(source, [
    /single[- ]leg.*rdl/i,
    /single[- ]arm.*cable.*pull/i,
    /single[- ]leg.*step[- ]?up/i,
    /hip flexor.*cable/i,
    /single[- ]leg.*glute bridge|single[- ]leg.*hip thrust/i,
    /seated shoulder press/i,
    /cable crunch/i,
    /hip cars/i,
  ], 6);
  const day2 = pickByPatterns(source, [
    /single[- ]leg.*hip thrust|single[- ]leg.*glute bridge/i,
    /standing.*hip flexor.*kb/i,
    /half kneeling.*adductor.*side/i,
    /db push|dumbbell.*push/i,
    /hamstring curl/i,
    /back extension/i,
    /single[- ]arm/i,
    /single[- ]leg/i,
  ], 6);
  const day3 = pickByPatterns(source, [
    /leg press/i,
    /knee extension/i,
    /hamstring curl/i,
    /kb.*deadlift|kettlebell.*deadlift|db.*deadlift|dumbbell.*deadlift/i,
    /seated shoulder press/i,
    /cable crunch/i,
    /back extension/i,
    /goblet squat/i,
  ], 6);

  const fallback = pickFoundationMain(source, big5, priorityIds);
  return [fillFoundationPool(day1, fallback, 6), fillFoundationPool(day2, rotate(fallback, 2), 6), fillFoundationPool(day3, rotate(fallback, 4), 6)];
}

function fillFoundationPool(primary: ExerciseRow[], fallback: ExerciseRow[], count: number): ExerciseRow[] {
  const combined = [...primary, ...fallback];
  const seen = new Set<string>();
  return combined.filter((exercise) => {
    if (seen.has(exercise.id)) return false;
    seen.add(exercise.id);
    return true;
  }).slice(0, count);
}

function inferGymAccess(analysis: Record<string, unknown>): boolean {
  const raw = JSON.stringify(analysis).toLowerCase();
  const limitedSignals = [
    'bands only',
    'band only',
    'bodyweight only',
    'body weight only',
    'home only',
    'home workout',
    'no gym',
    'without gym',
    'minimal equipment',
    'travel workout',
    'hotel workout',
  ];
  return !limitedSignals.some((signal) => raw.includes(signal));
}

function isBandedExercise(exercise: ExerciseRow): boolean {
  const value = `${exercise.name} ${exercise.equipment ?? ''} ${(exercise.tags ?? []).join(' ')}`.toLowerCase();
  return /\bband(ed)?\b|\bresistance band\b|\bmini band\b/.test(value);
}

function foundationTempoNote(row: ExerciseRow, warmup: boolean): string {
  if (warmup) return 'Move slowly with control through the full range; no rushing.';
  const name = row.name.toLowerCase();
  if (/deadlift|rdl|hinge/.test(name)) return 'Tempo 3-1-2: controlled 3 sec lower, 1 sec pause, smooth drive up.';
  if (/squat|leg press|step|lunge|knee extension|hamstring curl/.test(name)) return 'Tempo 3-1-1: slow 3 sec eccentric, brief pause, controlled lift.';
  if (/press|push|row|pull|shoulder/.test(name)) return 'Tempo 2-1-2: controlled pull or press, pause, slow return.';
  if (/bridge|hip thrust|back extension|ql|crunch/.test(name)) return 'Controlled tempo with a 2 sec squeeze or pause at the strongest position.';
  return 'Use a slow controlled tempo and own the full range before adding load.';
}

function pickByPatterns(library: ExerciseRow[], patterns: RegExp[], count: number): ExerciseRow[] {
  const picked: ExerciseRow[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    const row = findExercise(library, pattern);
    if (row && !seen.has(row.id)) {
      picked.push(row);
      seen.add(row.id);
    }
    if (picked.length >= count) return picked;
  }
  for (const row of library) {
    if (!seen.has(row.id)) {
      picked.push(row);
      seen.add(row.id);
    }
    if (picked.length >= count) return picked;
  }
  return picked;
}

function rotate<T>(items: T[], offset: number): T[] {
  if (items.length === 0) return items;
  const shift = offset % items.length;
  return [...items.slice(shift), ...items.slice(0, shift)];
}

function programmeNameFromAnalysis(analysis: Record<string, unknown>): string {
  const goals = (analysis.goals ?? {}) as Record<string, unknown>;
  const primary = typeof goals.primary === 'string' ? goals.primary : 'Strength and Movement Quality';
  return `${primary} Programme`;
}

function goalFromAnalysis(analysis: Record<string, unknown>): string {
  const goals = (analysis.goals ?? {}) as Record<string, unknown>;
  return typeof goals.primary === 'string' ? goals.primary : 'Build strength, movement quality, and confidence.';
}

function appendConditionalBlocks(day: Record<string, unknown>, library: ExerciseRow[], methodologyPhase: Record<string, unknown>) {
  const exercises = (day.exercises as Array<Record<string, unknown>>) ?? [];
  const hasMetcon = exercises.some((e) => e.section_start === 'MetCon');
  const hasStretches = exercises.some((e) => e.section_start === 'Stretches');
  const cardioMinutes = typeof methodologyPhase.cardio_block_minutes === 'number' ? methodologyPhase.cardio_block_minutes : null;
  const mobilityMinutes = typeof methodologyPhase.mobility_block_minutes === 'number' ? methodologyPhase.mobility_block_minutes : null;

  if (cardioMinutes && !hasMetcon) {
    const cardio = findExercise(library, /(bike|row|tread|elliptical|sled|carry)/i);
    if (cardio) exercises.push(buildAppendedExercise(cardio, exercises.length + 1, '1', `${cardioMinutes} min steady`, 'MetCon'));
  }

  if (mobilityMinutes && !hasStretches) {
    const mobility = library
      .filter((e) => /(stretch|mobility|hip|thoracic|hamstring|flexor|opener)/i.test(`${e.name} ${(e.tags ?? []).join(' ')}`))
      .slice(0, 2);
    mobility.forEach((exercise) => {
      exercises.push(buildAppendedExercise(exercise, exercises.length + 1, '1', '30-60 sec', exercises.some((e) => e.section_start === 'Stretches') ? null : 'Stretches'));
    });
  }

  day.exercises = exercises;
}

function buildAppendedExercise(row: ExerciseRow, index: number, sets: string, reps: string, sectionStart: string | null): Record<string, unknown> {
  return {
    id: slugExerciseId(row.name, index),
    exercise_id: row.id,
    name: row.name,
    sets,
    reps,
    rest: '30 sec',
    notes: '',
    section_start: sectionStart,
    superset_id: null,
    video_url: row.video_url,
    cues: row.cues ?? [],
  };
}

function findExercise(library: ExerciseRow[], pattern: RegExp): ExerciseRow | undefined {
  return library.find((e) => pattern.test(`${e.name} ${(e.tags ?? []).join(' ')}`));
}

function defaultRest(sectionStart: string): string {
  if (sectionStart === 'Warm Up') return '30 sec';
  if (sectionStart === 'MetCon' || sectionStart === 'Stretches') return '30 sec';
  return '60 sec';
}

function slugExerciseId(name: string, index: number): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `ex-${slug || 'exercise'}-${index}`;
}

function filterLibraryForClient(library: ExerciseRow[], analysis: Record<string, unknown>): ExerciseRow[] {
  const big5Names = ['bb squat', 'bb deadlift', 'bb bench', 'bb shoulder press', 'pull-up', 'pull up'];
  const constraints = (analysis?.constraints ?? {}) as Record<string, unknown>;
  const injuries = (constraints.injuries as string[] | undefined ?? []).join(' ').toLowerCase();
  const restrictions = (constraints.mobility_restrictions as string[] | undefined ?? []).join(' ').toLowerCase();
  const blockers = `${injuries} ${restrictions}`.toLowerCase();

  const isContraindicated = (e: ExerciseRow): boolean => {
    const tags = (e.conditions ?? []).join(' ').toLowerCase();
    if (blockers.includes('shoulder') && /overhead|shoulder press|pike|handstand/.test(e.name.toLowerCase())) return true;
    if (blockers.includes('back') && /sit[- ]?up|crunch|good morning/.test(e.name.toLowerCase())) return true;
    if (blockers.includes('knee') && /pistol|jump squat|sissy/.test(e.name.toLowerCase())) return true;
    if (tags.length > 0 && /(avoid|contraindicated)/.test(tags) && blockers.split(' ').some((w) => w && tags.includes(w))) return true;
    return false;
  };

  const big5 = library.filter((e) => big5Names.some((n) => e.name.toLowerCase().includes(n)));
  const cardio = library.filter((e) => /(bike|row|tread|jog|run|skip|elliptical|sled|carry|prowler)/i.test(e.name) && !isContraindicated(e)).slice(0, 6);
  const warmup = library.filter((e) => /(band|mobility|stretch|activation|opener|cat[- ]?cow|world|hip|shoulder dislocate|scap)/i.test((e.tags ?? []).join(' ') + ' ' + e.name) && !isContraindicated(e)).slice(0, 25);
  const others = library
    .filter((e) => !big5.includes(e) && !cardio.includes(e) && !warmup.includes(e))
    .filter((e) => !isContraindicated(e))
    .slice(0, 150);

  const result = [...big5, ...warmup, ...cardio, ...others];
  const seen = new Set<string>();
  return result.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

function parseJson(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text); } catch { /* noop */ }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* noop */ } }
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a !== -1 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch { /* noop */ } }
  return null;
}
