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

You receive a muscle mind map (from physiotherapy-grade movement analysis). For EACH muscle in primary_issues, you generate a list of 6 exercises that directly address that muscle's specific issue and treatment type. Then you tag exercises that appear across multiple muscles as double-duty, and build the staples document.

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

  const authHeader = req.headers.get('Authorization') ?? '';
  const internalSecret = Deno.env.get('CEREBRO_INTERNAL_SECRET');
  if (!internalSecret || authHeader !== `Bearer ${internalSecret}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let fallbackMindMap: Record<string, unknown> = {};
  let fallbackLibrary: CompactExercise[] = [];
  try {
    const body = await req.json() as {
      client_id: string;
      muscle_mind_map: Record<string, unknown>;
      coach_directive?: string;
      client_analysis?: Record<string, unknown>;
      physio_brief?: string;
      constraints?: Record<string, unknown> | null;
    };
    if (!body.client_id || !body.muscle_mind_map) {
      return json({ error: 'client_id and muscle_mind_map required' }, 400);
        }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    fallbackMindMap = body.muscle_mind_map;

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
    const focusedLibrary = focusExerciseLibrary(compactLibrary, body.muscle_mind_map);
    fallbackLibrary = focusedLibrary;

    const directiveParts: string[] = [];
    if (body.coach_directive?.trim()) {
      directiveParts.push(`COACH REQUEST (honor this when selecting exercises, equipment, and emphasis):\n${body.coach_directive.trim().slice(0, 4000)}`);
    }
    if (body.physio_brief?.trim()) {
      directiveParts.push(`PHYSIO BRIEF (drive selection from this):\n${body.physio_brief.trim().slice(0, 2000)}`);
    }

    const userMessage = [
      ...directiveParts,
      `MUSCLE MIND MAP:\n${JSON.stringify(body.muscle_mind_map, null, 2)}`,
      `FOCUSED EXERCISE LIBRARY (${focusedLibrary.length} of ${compactLibrary.length} exercises -- use these ids for exercise_id matching):\n${JSON.stringify(focusedLibrary)}`,
      'Output the exercise intelligence JSON now. JSON only, no prose, no code fences.',
    ].join('\n\n---\n\n');

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });

    // Keep this well below the orchestrator fetch timeout. If the model is slow,
    // quota-limited, or stalls, deterministic exercise intelligence still gives
    // the builder a personalised pool from the muscle mind map.
    const CLAUDE_TIMEOUT_MS = 20_000;
    const modelCall = anthropic.messages.create(
        {
          model: 'claude-sonnet-4-6',
          max_tokens: 4500,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
        }
      )
      .then((msg) => (msg.content[0] as { text: string }).text)
      .catch((modelError) => {
        console.warn('exercise-intelligence-agent model fallback:', modelError);
        return null;
      });
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), CLAUDE_TIMEOUT_MS));
    const text = await Promise.race([modelCall, timeout]);
    if (!text) {
      return json({ ok: true, ...buildFallbackExerciseIntelligence(body.muscle_mind_map, focusedLibrary) });
    }

    const parsed = parseJson(text);
    if (!parsed) {
      return json({ ok: true, ...buildFallbackExerciseIntelligence(body.muscle_mind_map, focusedLibrary) });
    }

    return json({ ok: true, ...parsed });
  } catch (error) {
    console.error('exercise-intelligence-agent error:', error);
    return json({ ok: true, ...buildFallbackExerciseIntelligence(fallbackMindMap, fallbackLibrary) });
  }
});

type CompactExercise = {
  id: string;
  name: string;
  muscles: string[];
  equipment: string | null;
};

function focusExerciseLibrary(library: CompactExercise[], mindMap: Record<string, unknown>): CompactExercise[] {
  const terms = new Set<string>([
    'squat', 'deadlift', 'bench', 'press', 'pull-up', 'pulldown',
    'lunge', 'split squat', 'rdl', 'hip thrust', 'bridge', 'row',
    'pallof', 'plank', 'clamshell', 'adductor', 'cossack', 'step up',
    'mobility', 'stretch', 'hip', 'thoracic',
  ]);

  const primaryIssues = Array.isArray(mindMap.primary_issues) ? mindMap.primary_issues : [];
  for (const issue of primaryIssues) {
    if (!isRecord(issue)) continue;
    const muscles = Array.isArray(issue.muscles) ? issue.muscles : [];
    for (const muscle of muscles) {
      if (!isRecord(muscle)) continue;
      addWords(terms, muscle.name);
      const specific = Array.isArray(muscle.specific_muscles) ? muscle.specific_muscles : [];
      specific.forEach((item) => addWords(terms, item));
    }
  }

  const scored = library.map((exercise, index) => {
    const haystack = `${exercise.name} ${exercise.muscles.join(' ')} ${exercise.equipment ?? ''}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (term.length >= 3 && haystack.includes(term.toLowerCase())) score += term.length > 5 ? 2 : 1;
    }
    return { exercise, index, score };
  });

  const selected = scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 180)
    .map((item) => item.exercise);

  if (selected.length >= 80) return selected;
  const seen = new Set(selected.map((exercise) => exercise.id));
  for (const exercise of library) {
    if (seen.has(exercise.id)) continue;
    selected.push(exercise);
    seen.add(exercise.id);
    if (selected.length >= 120) break;
  }
  return selected;
}

function addWords(target: Set<string>, value: unknown) {
  if (typeof value !== 'string') return;
  const cleaned = value.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
  if (!cleaned) return;
  target.add(cleaned);
  cleaned.split(/\s+/).filter((word) => word.length >= 4).forEach((word) => target.add(word));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(text: string): Record<string, unknown> | null {
  const t = text.trim();
  try { return JSON.parse(t); } catch { /* noop */ }
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) { try { return JSON.parse(fenced[1].trim()); } catch { /* noop */ } }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a !== -1 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* noop */ } }
  if (a !== -1) { try { return JSON.parse(closeTruncatedJson(t.slice(a))); } catch { /* noop */ } }
  return null;
}

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

function buildFallbackExerciseIntelligence(mindMap: Record<string, unknown>, library: CompactExercise[]): Record<string, unknown> {
  const primaryIssues = Array.isArray(mindMap.primary_issues) ? mindMap.primary_issues : [];
  const exercises = new Map<string, Record<string, unknown>>();
  const compoundReadiness = stringValue(mindMap.compound_readiness, 'low') as 'low' | 'medium' | 'high';
  const overallLevel = stringValue(mindMap.overall_level, 'beginner') as 'beginner' | 'intermediate' | 'advanced';

  for (const issue of primaryIssues) {
    if (!isRecord(issue)) continue;
    const issueName = stringValue(issue.issue, 'movement issue');
    const muscles = Array.isArray(issue.muscles) ? issue.muscles : [];
    for (const muscle of muscles) {
      if (!isRecord(muscle)) continue;
      const muscleName = stringValue(muscle.name, '');
      if (!muscleName) continue;
      const status = stringValue(muscle.status, 'weak');
      const treatmentTypes = status === 'tight'
        ? ['strengthen', 'full_ROM', 'flexibility', 'mobility']
        : ['strengthen'];
      const picks = pickExercisesForMuscle(library, muscleName).slice(0, 6);
      for (const pick of picks) {
        const key = pick.name.toLowerCase();
        const existing = exercises.get(key);
        const primary = existing ? asStringList(existing.primary_muscles) : [];
        const problems = existing ? asStringList(existing.problems_solved) : [];
        const treatments = existing ? asStringList(existing.treatment_types) : [];
        exercises.set(key, {
          name: pick.name,
          exercise_id: pick.id,
          difficulty: difficultyForExercise(pick.name),
          primary_muscles: Array.from(new Set([...primary, muscleName])),
          secondary_muscles: pick.muscles.filter((name) => name.toLowerCase() !== muscleName.toLowerCase()).slice(0, 4),
          double_duty: Boolean(existing),
          double_duty_note: existing ? `This exercise recruits ${Array.from(new Set([...primary, muscleName])).join(', ')} across multiple client findings.` : null,
          problems_solved: Array.from(new Set([...problems, issueName])),
          treatment_types: Array.from(new Set([...treatments, ...treatmentTypes])),
        });
      }
    }
  }

  const list = Array.from(exercises.values());
  return {
    exercise_master_list: list,
    staples_by_phase: {
      foundation: {
        weeks_1_4: ['Goblet Squat', 'DB RDL', 'DB Bench Press', 'Half Kneeling Shoulder Press', 'Lat Pull-Down', 'Half Kneeling Adductor Slides'],
        weeks_5_7: ['BB Squat', 'BB Deadlift', 'BB Bench Press', 'BB Shoulder Press', 'Pull-up', 'Half Kneeling Adductor Slides'],
      },
      hypertrophy: ['BB Squat', 'BB Deadlift', 'BB Bench Press', 'BB Shoulder Press', 'Pull-up', 'Deficit Reverse Lunge', 'Hip Thrust', 'Single Leg Hip Thrust'],
      strength: ['BB Squat', 'BB Deadlift', 'BB Bench Press', 'BB Shoulder Press', 'Pull-up', 'Deficit Reverse Lunge', 'Hip Thrust', 'Single Leg Hip Thrust'],
      client_specific_additions: list.slice(0, 6).map((exercise) => ({
        exercise: exercise.name,
        reason: `Selected from the client's muscle mind map for ${asStringList(exercise.primary_muscles).join(', ')}.`,
        phases: ['foundation', 'hypertrophy', 'strength'],
      })),
    },
    missing_exercises: [],
    starting_difficulty_target: compoundReadiness === 'low' ? '2-3' : '3-4',
    compound_readiness: compoundReadiness,
    overall_level: overallLevel,
    fallback_used: true,
  };
}

function pickExercisesForMuscle(library: CompactExercise[], muscleName: string): CompactExercise[] {
  const terms = new Set<string>();
  addWords(terms, muscleName);
  const lowered = muscleName.toLowerCase();
  if (/glute|hip/.test(lowered)) ['hip thrust', 'glute bridge', 'rdl', 'lunge', 'split squat', 'step up'].forEach((term) => terms.add(term));
  if (/hamstring|posterior/.test(lowered)) ['rdl', 'deadlift', 'hamstring curl', 'hip thrust', 'back extension'].forEach((term) => terms.add(term));
  if (/quad|knee/.test(lowered)) ['squat', 'leg press', 'knee extension', 'lunge', 'step up'].forEach((term) => terms.add(term));
  if (/core|oblique|lumbar|ql/.test(lowered)) ['pallof', 'plank', 'dead bug', 'cable crunch', 'back extension'].forEach((term) => terms.add(term));
  if (/shoulder|rotator|scap|trap|serratus/.test(lowered)) ['row', 'face pull', 'shoulder press', 'external rotation', 'wall slide'].forEach((term) => terms.add(term));
  if (/lat|back|thoracic/.test(lowered)) ['row', 'pulldown', 'pull up', 'thoracic', 'face pull'].forEach((term) => terms.add(term));
  if (/adductor/.test(lowered)) ['adductor', 'cossack', 'lunge', 'split', 'copenhagen'].forEach((term) => terms.add(term));

  const scored = library.map((exercise, index) => {
    const haystack = `${exercise.name} ${exercise.muscles.join(' ')} ${exercise.equipment ?? ''}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (term.length >= 3 && haystack.includes(term.toLowerCase())) score += term.length > 5 ? 2 : 1;
    }
    return { exercise, index, score };
  });
  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.exercise);
}

function difficultyForExercise(name: string): 1 | 2 | 3 | 4 | 5 {
  const n = name.toLowerCase();
  if (/snatch|clean|jerk|toes.*bar|handstand|pistol/.test(n)) return 5;
  if (/barbell|bb |back squat|deadlift|bench press|overhead press|pull[- ]?up|chin[- ]?up/.test(n)) return 4;
  if (/bulgarian|single.*leg|deficit|hip thrust|cable.*single|split squat/.test(n)) return 3;
  if (/goblet|dumbbell|db |kettlebell|kb |half kneeling|machine|seated|cable/.test(n)) return 2;
  return 1;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}
