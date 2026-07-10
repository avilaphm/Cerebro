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
   - Pain, injury history, movement restrictions, and movement-screen findings outrank performance goals.
     A pull-up goal gets one pulling slot per day; hip/back/knee issues still drive the rest of Foundation.
   - Day 1 and Day 3 must emphasize single-arm and single-leg work. Day 2 must emphasize bilateral/two-arm/two-leg work.
   - Each Foundation Workout day needs: 1 pull, 1 push, 1 anterior lower-body, 1 posterior lower-body,
     and 1-2 hip/core/corrective exercises. Do not repeat multiple variations of the same root exercise family.
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

6. CARDIO BLOCK: do not output cardio exercises. The server appends them outside Foundation when MethodologyPlan phase.cardio_block_minutes is set.

7. MOBILITY BLOCK: do not output mobility/stretching exercises. The server appends them outside Foundation when MethodologyPlan phase.mobility_block_minutes is set.

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

  const authHeader = req.headers.get('Authorization') ?? '';
  const internalSecret = Deno.env.get('CEREBRO_INTERNAL_SECRET');
  if (!internalSecret || authHeader !== `Bearer ${internalSecret}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await req.json() as {
      client_analysis: Record<string, unknown>;
      muscle_mind_map?: Record<string, unknown>;
      methodology_plan_phase: Record<string, unknown>;
      phase_index: number;
      programme_name?: string;
      programme_goal?: string;
      exercise_master_list?: Array<{ exercise_id: string | null; name: string; difficulty: number }>;
      coach_directive?: string;
      physio_brief?: string;
      constraints?: { equipment?: string; location?: string; focus_areas?: string[]; exercises_per_day?: number; session_length_min?: number; avoid?: string[] } | null;
      intent?: 'journey' | 'one_off';
      bespoke?: boolean;
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

    // BESPOKE mode (bodyweight / home / minimal-equipment / one-off request): skip the
    // deterministic Big-5 template and let the model build exactly what the coach asked.
    // STANDARD mode keeps the proven deterministic path (Big-5 anchored); its accessories
    // already reflect the coach's request via the exercise-intelligence master list (priorityIds).
    // Trust the orchestrator's computed flag (it also reads the client-analysis equipment);
    // fall back to local detection for direct callers.
    const bespoke = typeof body.bespoke === 'boolean' ? body.bespoke : isBespoke(body.constraints, body.intent, body.coach_directive ?? '');
    const deterministic = bespoke
      ? null
      : buildDeterministicPhase(body.methodology_plan_phase, library, filtered, body.phase_index, body.client_analysis, body.muscle_mind_map ?? {}, priorityIds, body.constraints ?? null);
    if (deterministic) return json({ ok: true, ...deterministic });

    const directiveParts: string[] = [];
    if (body.coach_directive?.trim()) directiveParts.push(`COACH REQUEST (honor this exactly):\n${body.coach_directive.trim().slice(0, 4000)}`);
    if (body.physio_brief?.trim()) directiveParts.push(`PHYSIO BRIEF:\n${body.physio_brief.trim().slice(0, 2000)}`);
    if (bespoke) {
      directiveParts.push(
        "BESPOKE MODE: The coach's request overrides the standard-structure hard rules. "
        + 'Rules 2 and 3 (fixed 3-day Foundation, all-Big-5 every hypertrophy/strength day) and the fixed 6-exercise / 3-superset count DO NOT apply. '
        + 'Build exactly what the coach asked: honor the equipment available, the requested number of exercises per day, the focus area(s), and any avoid list. '
        + 'EQUIPMENT IS A HARD FILTER. If the request is bodyweight / "no weights" / home-only, you must NOT use any exercise whose name or equipment implies external load: no Back Squat, Front Squat, Conventional/Romanian/Trap-bar Deadlift, Barbell/DB Bench, Barbell/DB Bulgarian Split Squat, Leg Press, Cable/Machine/Smith exercises, Kettlebell, or anything containing Barbell/BB/Dumbbell/DB/Cable/Machine/Leg Press. Substitute the bodyweight variant of that pattern: barbell/goblet squat -> bodyweight squat / split squat / step-up / pistol progression; deadlift/RDL -> single-leg RDL (bodyweight) / Nordic curl / band good morning / hip thrust; bench/DB press -> push-up variations; row -> inverted (bodyweight) row; overhead press -> pike push-up. Bands and a pull-up bar are allowed only if the coach mentioned them. '
        + 'MOVEMENT PATTERN COVERAGE + VARIETY: across the workout, cover the fundamental patterns the available equipment allows - hinge, squat, horizontal push, vertical push, horizontal pull, vertical pull, plus core/anti-rotation. Do NOT repeat the same exercise, and do not stack multiple variations of one pattern in a single day; vary exercises across days and pick different movements even when a focus area is given (a "hip" focus still needs push and pull work for balance). '
        + 'For BODYWEIGHT specifically, choose from patterns like: hinge = single-leg / B-stance RDL, good morning, hip thrust, Nordic curl, glute bridge; squat = squat, split squat, step-up, cossack, pistol progression; horizontal push = push-up variations; vertical push = pike push-up, handstand progression; horizontal pull = inverted / towel row; vertical pull = pull-up, chin-up, band-assisted pull; core = plank, hollow hold, dead bug, leg raise. Prefer library exercises that match these; if the ideal pattern exercise is not in the library, add its name to missing_exercises rather than repeating another exercise. '
        + 'Still obey: every exercise_id is a real library id; canonical section order (Warm Up, Workout, MetCon, Stretches); open with a short warm-up unless the coach said otherwise.',
      );
    }

    const userMessage = [
      ...directiveParts,
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

    let enriched = enrichPhase(parsed, library, body.methodology_plan_phase);
    // In bespoke mode the model may pick pattern exercises the library doesn't have yet (common
    // for bodyweight). Create real cards for them so they link and pass validation, instead of
    // being dropped - this is what gives bespoke workouts genuine movement variety.
    if (bespoke) enriched = await resolveMissingBespokeExercises(admin, enriched, library);

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

// Bespoke create-missing: any exercise the model named but that isn't linked to a real library
// row gets a card created (upsert on the lower(name) unique index) and re-linked, mirroring
// ensureExerciseCardsForMasterList in the orchestrator. Guarantees bespoke variety survives.
async function resolveMissingBespokeExercises(
  admin: ReturnType<typeof createClient>,
  enriched: Record<string, unknown>,
  library: ExerciseRow[],
): Promise<Record<string, unknown>> {
  const byId = new Set(library.map((e) => e.id));
  const phase = (enriched.phase ?? {}) as Record<string, unknown>;
  const days = (phase.days as Array<Record<string, unknown>>) ?? [];

  const unlinked: Array<Record<string, unknown>> = [];
  for (const day of days) {
    for (const ex of ((day.exercises as Array<Record<string, unknown>>) ?? [])) {
      const id = ex.exercise_id as string | undefined;
      const name = (ex.name as string | undefined)?.trim();
      if (name && (!id || !byId.has(id))) unlinked.push(ex);
    }
  }
  if (unlinked.length === 0) return enriched;

  const names = Array.from(new Set(unlinked.map((e) => String(e.name)).filter(Boolean)));
  const { data: existing } = await admin.from('pt_exercises').select('id, name, video_url, cues').in('name', names);
  const byName = new Map<string, { id: string; video_url: string | null; cues: unknown }>(
    (existing ?? []).map((r: { id: string; name: string; video_url: string | null; cues: unknown }) => [r.name.toLowerCase(), r]),
  );

  const toCreate = names.filter((n) => !byName.has(n.toLowerCase()));
  if (toCreate.length > 0) {
    const { data: created } = await admin
      .from('pt_exercises')
      .upsert(toCreate.map((name) => ({
        name,
        muscles: [],
        primary_muscles: [],
        secondary_muscles: [],
        purpose: null,
        equipment: null,
        video_url: null,
        cues: [],
        setup_cues: [],
        tags: ['ai-generated', 'needs-video', 'bespoke'],
        conditions: [],
        source: 'ai',
      })), { onConflict: 'name' })
      .select('id, name, video_url, cues');
    (created ?? []).forEach((r: { id: string; name: string; video_url: string | null; cues: unknown }) => byName.set(r.name.toLowerCase(), r));
  }

  for (const ex of unlinked) {
    const row = byName.get(String(ex.name).toLowerCase());
    if (row) {
      ex.exercise_id = row.id;
      ex.video_url = row.video_url ?? null;
      ex.cues = row.cues ?? [];
    }
  }

  const stillMissing = unlinked
    .filter((ex) => !byName.has(String(ex.name).toLowerCase()))
    .map((ex) => String(ex.name));
  enriched.missing_exercises = stillMissing;
  enriched.unresolved_count = stillMissing.length;
  return enriched;
}

function buildDeterministicPhase(
  methodologyPhase: Record<string, unknown>,
  library: ExerciseRow[],
  filteredLibrary: ExerciseRow[],
  phaseIndex: number,
  analysis: Record<string, unknown>,
  muscleMindMap: Record<string, unknown> = {},
  priorityIds: Set<string> = new Set(),
  constraints: { equipment?: string } | null = null,
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
    const isGymAccess = inferGymAccess(analysis, constraints);
    const foundationLibrary = prepareFoundationLibrary(library, analysis, isGymAccess);
    const foundationContext = foundationPriorityContext(analysis, muscleMindMap);
    const days = [0, 1, 2].map((dayIndex) => {
      const foundationDay = buildFoundationDay(dayIndex, foundationLibrary, foundationContext, priorityIds);
      const exercises = [
        ...foundationDay.warmups.map((row, index) => buildExercise(row, index + 1, '1', '10-12', '30 sec', foundationTempoNote(row, true), index === 0 ? 'Warm Up' : null, 'warmup')),
        ...foundationDay.workout.map((row, index) => buildExercise(row, index + 5, sets, '10-12', '60 sec', foundationTempoNote(row, false), index === 0 ? 'Workout' : null, `ss-${foundationDay.supersetIds[index] ?? Math.floor(index / 2) + 1}`)),
      ];
      const day = {
        id: `day-${dayIndex + 1}`,
        title: `Day ${dayIndex + 1} - ${dayIndex === 1 ? 'Bilateral' : 'Unilateral'} Foundation`,
        focus: dayIndex === 1
          ? 'Bilateral pattern confidence, controlled loading, and compound readiness.'
          : 'Single-arm and single-leg control, movement quality, glute strength, and core control.',
        exercises,
      };
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

interface FoundationContext {
  raw: string;
  hasHipPriority: boolean;
  hasBackPriority: boolean;
  hasKneePriority: boolean;
  hasPullGoal: boolean;
}

interface FoundationDaySelection {
  warmups: ExerciseRow[];
  workout: ExerciseRow[];
  supersetIds: string[];
}

function prepareFoundationLibrary(library: ExerciseRow[], analysis: Record<string, unknown>, isGymAccess: boolean): ExerciseRow[] {
  const raw = JSON.stringify(analysis).toLowerCase();
  return library.filter((exercise) => {
    const name = exercise.name.toLowerCase();
    if (isGymAccess && isBandedExercise(exercise)) return false;
    if (/(burpee|box jump|jump|hop|plyo|skipping|sprint)/i.test(name) && /(dizz|meniscus|knee|impact|jump)/i.test(raw)) return false;
    if (/(pistol|sissy squat)/i.test(name) && /(meniscus|knee|single-leg stability|balance poor)/i.test(raw)) return false;
    return true;
  });
}

function foundationPriorityContext(analysis: Record<string, unknown>, muscleMindMap: Record<string, unknown>): FoundationContext {
  const raw = `${JSON.stringify(analysis)} ${JSON.stringify(muscleMindMap)}`.toLowerCase();
  return {
    raw,
    hasHipPriority: /(hip|glute|adductor|piriformis|faber|internal rotation|ir\b)/i.test(raw),
    hasBackPriority: /(back|lumbar|ql|erector|spine|pelvis|pelvic)/i.test(raw),
    hasKneePriority: /(knee|meniscus|patella|vmo|single-leg stability|balance)/i.test(raw),
    hasPullGoal: /(pull[- ]?up|chin[- ]?up|pulling)/i.test(raw),
  };
}

function buildFoundationDay(dayIndex: number, library: ExerciseRow[], context: FoundationContext, priorityIds: Set<string>): FoundationDaySelection {
  const usedIds = new Set<string>();
  const usedFamilies = new Set<string>();
  const warmups = pickFoundationWarmups(dayIndex, library, context, usedIds, usedFamilies);

  const workoutUsedIds = new Set<string>(warmups.map((exercise) => exercise.id));
  const workoutUsedFamilies = new Set<string>();
  const daySlots = foundationWorkoutSlots(dayIndex, context);
  const workout = daySlots.map((slot) =>
    pickForFoundationSlot(library, slot.patterns, workoutUsedIds, workoutUsedFamilies, priorityIds, slot.fallbackCategory)
  ).filter((row): row is ExerciseRow => Boolean(row));

  while (workout.length < 6) {
    const fallback = pickForFoundationSlot(
      library,
      [/cable crunch|pallof|dead bug|plank|back extension|ql/i, /hip|glute|row|press|squat|lunge|deadlift|rdl/i],
      workoutUsedIds,
      workoutUsedFamilies,
      priorityIds,
      'corrective',
    );
    if (!fallback) break;
    workout.push(fallback);
  }

  return {
    warmups,
    workout: workout.slice(0, 6),
    supersetIds: daySlots.map((slot) => slot.supersetId).slice(0, 6),
  };
}

function pickFoundationWarmups(
  dayIndex: number,
  library: ExerciseRow[],
  context: FoundationContext,
  usedIds: Set<string>,
  usedFamilies: Set<string>,
): ExerciseRow[] {
  const hipFirst = context.hasHipPriority || context.hasBackPriority || context.hasKneePriority;
  const patterns = dayIndex === 1
    ? [
      /pigeon|90\/90|90-90|hip.*external|hip.*rotation/i,
      /adductor.*rock|adductor.*slide|cossack.*prep/i,
      /open book|thread.*needle|thoracic|cat[- ]?cow/i,
      /calf raise|ankle|bodyweight.*squat|dead bug/i,
    ]
    : dayIndex === 2
      ? [
        /hip airplane/i,
        /thoracic|open book|thread.*needle|cat[- ]?cow/i,
        /clamshell|glute bridge|side plank/i,
        /hip.*car|capsular|hip.*ir|90\/90|90-90/i,
      ]
      : [
        /90\/90|90-90|hip.*external|hip.*rotation|hip.*car/i,
        /hip flexor|couch stretch|triangle/i,
        /thread.*needle|open book|thoracic|cat[- ]?cow/i,
        /jefferson curl|dead bug|bodyweight.*squat|glute bridge/i,
      ];
  const fallback = hipFirst ? [/hip|glute|adductor|thoracic|dead bug|cat[- ]?cow|mobility/i] : [/mobility|activation|opener|bodyweight/i];
  return patterns.map((pattern) => pickForFoundationSlot(library, [pattern, ...fallback], usedIds, usedFamilies, new Set(), 'warmup'))
    .filter((row): row is ExerciseRow => Boolean(row))
    .slice(0, 4);
}

function foundationWorkoutSlots(dayIndex: number, context: FoundationContext): Array<{ patterns: RegExp[]; fallbackCategory: string; supersetId: string }> {
  const corrective = context.hasHipPriority || context.hasBackPriority || context.hasKneePriority
    ? [
      /hip airplane|hip.*ir|standing.*hip|hip.*car|capsular/i,
      /adductor|cossack|patrick|step down|cable crunch|pallof|ql|back extension/i,
    ]
    : [/cable crunch|pallof|dead bug|plank/i, /hip|glute|back extension/i];

  if (dayIndex === 1) {
    return [
      { patterns: [/double.*kettlebell.*sumo.*deadlift|double.*kb.*deadlift/i, /kb.*deadlift|kettlebell.*deadlift|dumbbell.*deadlift|trap bar.*deadlift/i, /deadlift/i], fallbackCategory: 'bilateral_posterior_lower', supersetId: '1' },
      { patterns: [/^dumbbell bench press$/i, /dumbbell.*bench press|db.*bench/i, /chest press|seated shoulder press|cable.*chest.*fly/i, /bench press/i], fallbackCategory: 'push', supersetId: '1' },
      { patterns: [/assisted.*cossack|cossack/i, /leg press|goblet squat|knee extension|squat/i], fallbackCategory: 'bilateral_anterior_lower', supersetId: '2' },
      { patterns: [/lat pulldown|seated row|cable row|row|pull up/i], fallbackCategory: 'pull', supersetId: '2' },
      { patterns: [/single.*leg.*glute bridge|glute bridge|hip thrust/i, corrective[0]], fallbackCategory: 'corrective', supersetId: '3' },
      { patterns: [/ql|back extension|cable crunch|pallof|dead bug|plank/i, corrective[1]], fallbackCategory: 'corrective', supersetId: '3' },
    ];
  }

  if (dayIndex === 2) {
    return [
      { patterns: [/reverse lunge|split squat|step[- ]?down|step[- ]?up|patrick/i], fallbackCategory: 'anterior_lower', supersetId: '1' },
      { patterns: [/seated row|cable row|single.*arm.*row|half kneeling.*row|single.*arm.*cable.*pull|lat pulldown|pull up/i], fallbackCategory: 'pull', supersetId: '1' },
      { patterns: [/landmine.*half kneeling.*press|half kneeling.*shoulder press|single.*arm.*shoulder press|dumbbell.*shoulder press|db.*press|push/i], fallbackCategory: 'push', supersetId: '2' },
      { patterns: [/single.*leg.*rdl|dumbbell.*single.*leg.*romanian|db.*single.*leg.*rdl|rdl|romanian deadlift/i], fallbackCategory: 'posterior_lower', supersetId: '2' },
      { patterns: [corrective[0], /hip airplane|hip.*ir|hip.*car|capsular/i], fallbackCategory: 'corrective', supersetId: '3' },
      { patterns: [corrective[1], /cable crunch|pallof|ql|back extension|adductor|step[- ]?down/i], fallbackCategory: 'corrective', supersetId: '3' },
    ];
  }

  return [
    { patterns: [/goblet squat|step[- ]?up|reverse lunge|split squat|step[- ]?down|leg press/i], fallbackCategory: 'anterior_lower', supersetId: '1' },
    { patterns: [/half kneeling.*single.*arm.*high row|single.*arm.*row|single.*arm.*cable.*pull|seated row|cable row|lat pulldown|pull up/i], fallbackCategory: 'pull', supersetId: '1' },
    { patterns: [/single.*leg.*rdl|db.*single.*leg.*rdl|dumbbell.*single.*leg.*romanian|rdl|hip thrust|glute bridge/i], fallbackCategory: 'posterior_lower', supersetId: '2' },
    { patterns: [/half kneeling.*shoulder press|single.*arm.*shoulder press|landmine.*press|db.*press|dumbbell.*press|cable.*chest.*fly|bench press/i], fallbackCategory: 'push', supersetId: '2' },
    { patterns: [corrective[0], /hip airplane|hip.*car|capsular|hip.*ir/i], fallbackCategory: 'corrective', supersetId: '3' },
    { patterns: [corrective[1], /patrick|step[- ]?down|adductor|cable crunch|pallof|ql|back extension/i], fallbackCategory: 'corrective', supersetId: '3' },
  ];
}

function pickForFoundationSlot(
  library: ExerciseRow[],
  patterns: RegExp[],
  usedIds: Set<string>,
  usedFamilies: Set<string>,
  priorityIds: Set<string>,
  fallbackCategory: string,
): ExerciseRow | null {
  const candidates = [
    ...orderedPatternMatches(library, patterns).filter((row) => priorityIds.has(row.id)),
    ...orderedPatternMatches(library, patterns),
    ...library.filter((row) => categoryMatchesFoundationFallback(row, fallbackCategory)),
  ].filter((row) => slotAllowsFoundationRow(row, fallbackCategory));
  for (const row of candidates) {
    const family = exerciseFamily(row);
    if (usedIds.has(row.id) || usedFamilies.has(family)) continue;
    usedIds.add(row.id);
    usedFamilies.add(family);
    return row;
  }
  for (const row of candidates) {
    if (usedIds.has(row.id)) continue;
    usedIds.add(row.id);
    usedFamilies.add(exerciseFamily(row));
    return row;
  }
  return null;
}

function orderedPatternMatches(library: ExerciseRow[], patterns: RegExp[]): ExerciseRow[] {
  const seen = new Set<string>();
  const rows: ExerciseRow[] = [];
  for (const pattern of patterns) {
    for (const row of library) {
      if (!seen.has(row.id) && exerciseMatches(row, pattern)) {
        rows.push(row);
        seen.add(row.id);
      }
    }
  }
  return rows;
}

function categoryMatchesFoundationFallback(row: ExerciseRow, fallbackCategory: string): boolean {
  const category = foundationCategory(row);
  const name = row.name.toLowerCase();
  if (fallbackCategory === 'bilateral_anterior_lower') {
    return category === 'anterior_lower' && !/(single|split squat|lunge|step[- ]?up|step[- ]?down|pistol)/.test(name);
  }
  if (fallbackCategory === 'bilateral_posterior_lower') {
    return category === 'posterior_lower' && !/(single|b-stance|kickstand)/.test(name);
  }
  return category === fallbackCategory;
}

function slotAllowsFoundationRow(row: ExerciseRow, fallbackCategory: string): boolean {
  const category = foundationCategory(row);
  const name = row.name.toLowerCase();
  const tags = (row.tags ?? []).join(' ').toLowerCase();
  if (fallbackCategory === 'warmup') {
    return (category === 'corrective' || category === 'warmup') && !/(strength-compound|strength-isolation)/.test(tags) && !/(pull[- ]?up|chin[- ]?up|bench|deadlift|rdl|press|row)/.test(name);
  }
  if (fallbackCategory === 'corrective') {
    if (category === 'pull' || category === 'push') return false;
    if (/(pull[- ]?up|chin[- ]?up|bench press|deadlift|rdl|romanian|shoulder press)/.test(name)) return false;
    return category === 'corrective' || /(glute bridge|side plank|clamshell|hip airplane|hip.*car|hip.*ir|capsular|adductor|patrick|step[- ]?down|cable crunch|pallof|dead bug|plank|ql|back extension)/.test(name);
  }
  if (fallbackCategory === 'bilateral_anterior_lower' || fallbackCategory === 'bilateral_posterior_lower') {
    return categoryMatchesFoundationFallback(row, fallbackCategory) && !isFoundationBig5Regression(row);
  }
  if ((fallbackCategory === 'push' || fallbackCategory === 'posterior_lower' || fallbackCategory === 'anterior_lower') && isFoundationBig5Regression(row)) return false;
  return category === fallbackCategory;
}

function isFoundationBig5Regression(row: ExerciseRow): boolean {
  const name = row.name.toLowerCase();
  return /(back squat|barbell bench press|conventional deadlift|overhead press)\b/.test(name);
}

function exerciseMatches(row: ExerciseRow, pattern: RegExp): boolean {
  return pattern.test(`${row.name} ${row.equipment ?? ''} ${(row.tags ?? []).join(' ')} ${(row.muscles ?? []).join(' ')}`);
}

function foundationCategory(row: ExerciseRow): string {
  const name = row.name.toLowerCase();
  const tags = (row.tags ?? []).join(' ').toLowerCase();
  const value = `${name} ${tags}`;
  if (/pull[- ]?up|chin[- ]?up|lat pulldown|row|single.*arm.*cable.*pull/.test(value)) return 'pull';
  if (/bench|press|push|fly|chest/.test(value)) return 'push';
  if (/squat|lunge|step[- ]?up|step[- ]?down|leg press|knee extension|cossack|patrick/.test(value)) return 'anterior_lower';
  if (/deadlift|rdl|romanian|hinge|hamstring curl|hip thrust|glute bridge|back extension/.test(value)) return 'posterior_lower';
  if (/hip|adductor|pallof|plank|dead bug|crunch|ql|core|thoracic|mobility|stretch/.test(value)) return 'corrective';
  if (/mobility|activation|opener|bodyweight/.test(value)) return 'warmup';
  return 'corrective';
}

function exerciseFamily(row: ExerciseRow): string {
  const name = row.name.toLowerCase();
  if (/pull[- ]?up|chin[- ]?up/.test(name)) return 'pull-up';
  if (/lat pulldown/.test(name)) return 'lat-pulldown';
  if (/row/.test(name)) return 'row';
  if (/rdl|romanian/.test(name)) return 'rdl';
  if (/deadlift/.test(name)) return 'deadlift';
  if (/cossack/.test(name)) return 'cossack';
  if (/goblet|squat|leg press|knee extension/.test(name)) return 'squat-knee';
  if (/lunge|split squat/.test(name)) return 'lunge';
  if (/step[- ]?up|step[- ]?down|patrick/.test(name)) return 'step';
  if (/hip thrust|glute bridge|bridge/.test(name)) return 'hip-thrust-bridge';
  if (/hamstring curl/.test(name)) return 'hamstring-curl';
  if (/bench|chest press|fly|push up|push/.test(name)) return 'horizontal-push';
  if (/shoulder press|landmine.*press|overhead press/.test(name)) return 'shoulder-press';
  if (/hip airplane/.test(name)) return 'hip-airplane';
  if (/hip.*ir|internal rotation|capsular/.test(name)) return 'hip-ir';
  if (/hip flexor/.test(name)) return 'hip-flexor';
  if (/adductor|pigeon|90\/90|90-90/.test(name)) return 'hip-adductor-rotation';
  if (/thoracic|open book|thread.*needle|cat[- ]?cow/.test(name)) return 'thoracic';
  if (/ql|back extension|jefferson/.test(name)) return 'trunk-extension';
  if (/dead bug|plank|pallof|crunch|core/.test(name)) return 'core';
  return name.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || row.id;
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

// Bespoke = the coach asked for something the fixed 5-phase Big-5 factory can't express:
// bodyweight/home/minimal-equipment, or an explicit one-off. In bespoke mode we skip the
// deterministic builder and let the model honor the request.
function isBespoke(
  constraints: { equipment?: string } | null | undefined,
  intent: string | undefined,
  coachDirective: string,
): boolean {
  if (intent === 'one_off') return true;
  const eq = constraints?.equipment;
  if (eq && ['bodyweight', 'home_minimal', 'bands', 'travel'].includes(eq)) return true;
  const t = coachDirective.toLowerCase();
  return /\bbodyweight\b|\bno weights?\b|\bno equipment\b|\bat home\b|\bhome workout\b|\bno gym\b|\bwithout gym\b|\bbands? only\b|\btravel workout\b|\bhotel\b|\bone[- ]?off\b/.test(t);
}

function inferGymAccess(analysis: Record<string, unknown>, constraints?: { equipment?: string } | null): boolean {
  const eq = constraints?.equipment;
  if (eq === 'full_gym') return true;
  if (eq && ['bodyweight', 'home_minimal', 'bands', 'travel'].includes(eq)) return false;
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
