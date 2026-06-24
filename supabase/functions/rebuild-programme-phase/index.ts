import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PEDRO_EMAILS = ['pedro@cerebroai.au', 'avila.phm@gmail.com'];
const SECTIONS = ['Warm Up', 'Workout', 'MetCon', 'Stretches'] as const;

const BIG_5_ALIASES: Record<string, string[]> = {
  'BB Squat': ['squat', 'bb squat', 'barbell squat', 'back squat'],
  'BB Deadlift': ['deadlift', 'bb deadlift', 'barbell deadlift', 'conventional deadlift', 'romanian deadlift', 'rdl'],
  'BB Bench Press': ['bench press', 'bb bench', 'barbell bench', 'chest press', 'bb chest press'],
  'BB Shoulder Press': ['shoulder press', 'overhead press', 'ohp', 'bb shoulder press', 'barbell shoulder press', 'military press'],
  'Pull-up': ['pull-up', 'pullup', 'pull up', 'chin-up', 'chinup'],
};

const CHECK_SYSTEM = `You are Pedro Avila's programme rebuild intake agent inside Cerebro.

The coach is replacing ONE selected programme phase from a voice/text brief.

Return valid JSON only:
{
  "ready": boolean,
  "missing_questions": string[],
  "captured": {
    "days_requested": number | null,
    "duration_weeks": number | null,
    "day_intents": string[],
    "must_use_exercises": string[],
    "avoid": string[]
  }
}

Ask questions only for critical gaps:
- number of training days;
- unclear main lift / main intent for one or more days;
- whether to keep or change week-block progression if the phase has no usable progression.
Keep questions short and practical. If the brief is enough, ready=true and missing_questions=[].`;

const WRITE_SYSTEM = `You are Pedro Avila's phase rebuild programme writer for Cerebro.

Replace ONE selected phase. Do not rewrite the full programme.

Return valid JSON only:
{
  "phase": {
    "title": string,
    "focus": string,
    "weeks": string,
    "progression": string,
    "week_blocks": [{"weeks": number, "sets": string, "weight_pct": string}],
    "days": [
      {
        "title": string,
        "focus": string,
        "exercises": [
          {
            "name": string,
            "section": "Warm Up" | "Workout" | "MetCon" | "Stretches",
            "sets": string,
            "reps": string,
            "rest": string,
            "superset_label": string,
            "notes": string,
            "weight_pct": string
          }
        ]
      }
    ]
  },
  "questions_answered": string[],
  "review_notes": string[]
}

Rules:
- Match the requested number of days exactly.
- Put Pedro's requested main lift/main movement near the top of each day's Workout section.
- Include Pedro's must-use exercises unless client history makes that inappropriate; explain in review_notes if changed.
- Consider client history: avoid needless recent repetition unless Pedro requested it, respect assessment/client constraints, and keep the phase coach-editable.
- Keep output compact. Warm-up 2-4 items, workout main work plus useful accessories, optional MetCon/Stretches only if requested or clearly useful.
- If replacing Hypertrophy or Strength, preserve or create week_blocks with sets and weight_pct. Use the existing selected phase blocks when compatible.
- For Big 5-compatible lifts, set exercise weight_pct only when it should differ from the phase block. Otherwise leave it empty.
- Use only the four canonical sections.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json('ok');

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized.' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const userSupa = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(url, serviceKey);

    const { data: { user }, error: authErr } = await userSupa.auth.getUser();
    if (authErr || !user) return json({ error: 'Unauthorized.' }, 401);

    const requesterEmail = user.email?.toLowerCase() ?? '';
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (profile?.role !== 'admin' && !PEDRO_EMAILS.includes(requesterEmail)) {
      return json({ error: 'Only Pedro can rebuild phases.' }, 403);
    }

    const body = await req.json() as {
      action?: 'check' | 'generate';
      assignment_id?: string;
      client_id?: string;
      phase_index?: number;
      transcript?: string;
      answers?: string[];
    };

    const action = body.action ?? 'check';
    const assignmentId = body.assignment_id;
    const clientId = body.client_id;
    const phaseIndex = Number.isInteger(body.phase_index) ? body.phase_index! : -1;
    const transcript = (body.transcript ?? '').trim();
    const answers = (body.answers ?? []).map((a) => a.trim()).filter(Boolean);

    if (!assignmentId || !clientId || phaseIndex < 0) return json({ error: 'Missing assignment, client, or phase.' }, 400);
    if (transcript.length < 10 && answers.length === 0) return json({ error: 'Speak or type the phase brief first.' }, 400);

    const context = await loadContext(admin, assignmentId, clientId, phaseIndex);
    if (!context.assignment) return json({ error: 'Programme not found.' }, 404);
    if (!context.selectedPhase) return json({ error: 'Selected phase not found.' }, 404);

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
    const prompt = buildPrompt(context, transcript, answers);

    if (action === 'check') {
      const check = await claudeJson<IntakeCheck>(anthropic, {
        system: CHECK_SYSTEM,
        user: prompt,
        maxTokens: 1200,
      });
      if (!check) return json({ error: 'Could not check the brief.' }, 502);
      return json({
        ok: true,
        ready: Boolean(check.ready),
        missing_questions: Array.isArray(check.missing_questions) ? check.missing_questions.slice(0, 5) : [],
        captured: check.captured ?? {},
        one_rm_map: context.oneRmMap,
      });
    }

    const written = await claudeJson<WrittenPhase>(anthropic, {
      system: WRITE_SYSTEM,
      user: prompt,
      maxTokens: 7000,
    });
    if (!written?.phase?.days || !Array.isArray(written.phase.days)) {
      return json({ error: 'Could not generate a replacement phase.' }, 502);
    }

    const assembled = await assemblePhase(admin, written.phase, context);
    const resolvedLoads = resolveLoads(assembled, context.oneRmMap);

    return json({
      ok: true,
      phase: assembled,
      one_rm_map: context.oneRmMap,
      resolved_loads: resolvedLoads,
      questions_answered: written.questions_answered ?? [],
      review_notes: written.review_notes ?? [],
      matched_count: assembled.days.flatMap((d) => d.exercises).filter((e) => e.exercise_id).length,
    });
  } catch (error) {
    console.error('rebuild-programme-phase error:', error);
    return json({ error: error instanceof Error ? error.message : 'Phase rebuild failed.' }, 500);
  }
});

interface AssignmentRow {
  id: string;
  client_id: string;
  name: string;
  goal: string | null;
  programme: Programme;
}

interface Programme { phases?: Phase[] }
interface Phase {
  id?: string;
  title?: string;
  focus?: string;
  weeks?: string;
  progression?: string;
  week_blocks?: Array<{ weeks: number; sets?: string; weight_pct?: string }>;
  days?: Day[];
}
interface Day { id?: string; title?: string; focus?: string; exercises?: Exercise[] }
interface Exercise {
  id?: string;
  exercise_id?: string | null;
  name?: string;
  section?: string;
  section_start?: string;
  sets?: string;
  reps?: string;
  rest?: string;
  notes?: string;
  video_url?: string | null;
  cues?: string[];
  superset_label?: string;
  superset_id?: string | null;
  weight_pct?: string;
  week_overrides?: Array<{ block_index: number; weight_pct?: string; [key: string]: unknown }>;
}
interface LibraryRow {
  id: string;
  name: string;
  video_url: string | null;
  cues: string[] | null;
  primary_muscles: string[] | null;
  secondary_muscles: string[] | null;
  muscles: string[] | null;
  tags?: string[] | null;
}
interface IntakeCheck {
  ready?: boolean;
  missing_questions?: string[];
  captured?: Record<string, unknown>;
}
interface WrittenPhase {
  phase?: Phase;
  questions_answered?: string[];
  review_notes?: string[];
}
interface Context {
  assignment: AssignmentRow | null;
  client: Record<string, unknown> | null;
  selectedPhase: Phase | null;
  phaseIndex: number;
  recentWorkoutLogs: unknown[];
  recentSetLogs: unknown[];
  notes: unknown[];
  exerciseDoc: unknown;
  oneRmMap: Record<string, number>;
  library: LibraryRow[];
}

async function loadContext(admin: ReturnType<typeof createClient>, assignmentId: string, clientId: string, phaseIndex: number): Promise<Context> {
  const [assignmentRes, clientRes, workoutRes, setRes, notesRes, exerciseDocRes, oneRmRes, libraryRes] = await Promise.all([
    admin.from('pt_program_assignments').select('id, client_id, name, goal, programme').eq('id', assignmentId).eq('client_id', clientId).single(),
    admin.from('pt_clients').select('id, name, goals, notes, lifestyle_context, coaching_focus, event_goal').eq('id', clientId).maybeSingle(),
    admin.from('pt_workout_logs').select('phase_index, day_index, week_number, block_index, workout_title, notes, created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(16),
    admin.from('pt_set_logs').select('exercise_id, exercise_name, set_number, reps, weight, notes, created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(80),
    admin.from('pt_client_notes').select('title, body, context, created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(12),
    admin.from('pt_client_exercise_doc').select('current_1rm, movement_mind_map, progression_strategy, notes').eq('client_id', clientId).maybeSingle(),
    admin.from('pt_client_1rm_results').select('exercise_name, tested_weight_kg, estimated_1rm_kg, created_at').eq('client_id', clientId).order('created_at', { ascending: false }),
    admin.from('pt_exercises').select('id, name, video_url, cues, primary_muscles, secondary_muscles, muscles, tags').order('name'),
  ]);

  const assignment = assignmentRes.data as AssignmentRow | null;
  const phases = Array.isArray(assignment?.programme?.phases) ? assignment!.programme.phases! : [];
  return {
    assignment,
    client: clientRes.data as Record<string, unknown> | null,
    selectedPhase: phases[phaseIndex] ?? null,
    phaseIndex,
    recentWorkoutLogs: workoutRes.data ?? [],
    recentSetLogs: setRes.data ?? [],
    notes: notesRes.data ?? [],
    exerciseDoc: exerciseDocRes.data ?? null,
    oneRmMap: buildOneRmMap(oneRmRes.data ?? []),
    library: (libraryRes.data ?? []) as LibraryRow[],
  };
}

function buildPrompt(context: Context, transcript: string, answers: string[]) {
  const phases = context.assignment?.programme?.phases ?? [];
  const compactProgramme = phases.map((phase, index) => ({
    index,
    title: phase.title,
    weeks: phase.weeks,
    week_blocks: phase.week_blocks,
    days: (phase.days ?? []).map((day) => ({
      title: day.title,
      focus: day.focus,
      exercises: (day.exercises ?? []).map((ex) => ex.name),
    })),
  }));

  return JSON.stringify({
    coach_brief: transcript,
    coach_answers: answers,
    selected_phase_index: context.phaseIndex,
    selected_phase: context.selectedPhase,
    client: context.client,
    assignment: { id: context.assignment?.id, name: context.assignment?.name, goal: context.assignment?.goal },
    programme_outline: compactProgramme,
    recent_workouts: context.recentWorkoutLogs,
    recent_sets: context.recentSetLogs,
    client_notes: context.notes,
    exercise_doc: context.exerciseDoc,
    one_rm_map: context.oneRmMap,
    library_names: context.library.map((e) => e.name).slice(0, 1400),
  });
}

async function assemblePhase(admin: ReturnType<typeof createClient>, parsed: Phase, context: Context): Promise<Phase> {
  const byNorm = new Map<string, LibraryRow>();
  for (const row of context.library) byNorm.set(normalise(row.name), row);

  const names = [...new Set((parsed.days ?? [])
    .flatMap((d) => d.exercises ?? [])
    .map((e) => String(e.name ?? '').trim())
    .filter(Boolean))];
  const resolved = new Map<string, LibraryRow>();
  const missing: string[] = [];

  for (const name of names) {
    const hit = matchLibrary(name, byNorm, context.library);
    if (hit) resolved.set(name, hit);
    else missing.push(name);
  }

  if (missing.length > 0) {
    const toInsert = missing.map((name) => ({
      name,
      primary_muscles: [] as string[],
      secondary_muscles: [] as string[],
      muscles: [] as string[],
      equipment: null,
      video_url: null,
      cues: [] as string[],
      setup_cues: [] as string[],
      tags: [] as string[],
      conditions: [] as string[],
      progression_ids: [] as string[],
      regression_ids: [] as string[],
      purpose: null,
      source: 'ai',
    }));
    const { data: inserted, error } = await admin
      .from('pt_exercises')
      .insert(toInsert)
      .select('id, name, video_url, cues, primary_muscles, secondary_muscles, muscles, tags');
    if (error) throw new Error(`Could not create missing exercise cards: ${error.message}`);
    for (const row of (inserted ?? []) as LibraryRow[]) {
      resolved.set(row.name, row);
      byNorm.set(normalise(row.name), row);
    }
  }

  const old = context.selectedPhase;
  const weekBlocks = sanitiseWeekBlocks(parsed.week_blocks, old);
  const days = (parsed.days ?? []).map((day, dayIndex) => {
    let lastSection = '';
    const exercises = (day.exercises ?? []).map((ex, exIndex) => {
      const name = String(ex.name ?? '').trim();
      const row = resolved.get(name) ?? matchLibrary(name, byNorm, context.library);
      const section = SECTIONS.includes(ex.section as typeof SECTIONS[number]) ? ex.section! : 'Workout';
      const sectionStart = section !== lastSection ? section : undefined;
      lastSection = section;
      const exercise: Exercise = {
        id: `ex-${dayIndex + 1}-${exIndex + 1}-${slug(row?.name ?? name)}`,
        exercise_id: row?.id ?? null,
        name: row?.name ?? name,
        sets: String(ex.sets ?? '3'),
        reps: String(ex.reps ?? '8-12'),
        rest: String(ex.rest ?? ''),
        notes: String(ex.notes ?? ''),
        video_url: row?.video_url ?? null,
        cues: row?.cues ?? [],
        superset_id: ex.superset_label ? `ss-${dayIndex + 1}-${slug(String(ex.superset_label))}` : null,
        section_start: sectionStart,
      };
      if (ex.weight_pct && matchCanonical(exercise.name ?? '')) {
        exercise.week_overrides = [{ block_index: 0, weight_pct: String(ex.weight_pct) }];
      }
      return exercise;
    });
    return {
      id: day.id ?? `day-${dayIndex + 1}-${slug(String(day.title ?? 'day'))}`,
      title: String(day.title ?? `Day ${dayIndex + 1}`),
      focus: String(day.focus ?? ''),
      exercises,
    };
  });

  return {
    id: old?.id ?? `phase-rebuild-${Date.now()}`,
    title: String(parsed.title ?? old?.title ?? 'Rebuilt phase'),
    focus: String(parsed.focus ?? old?.focus ?? ''),
    weeks: String(parsed.weeks ?? old?.weeks ?? totalWeeks(weekBlocks)),
    progression: String(parsed.progression ?? 'Rebuilt from Pedro voice/text brief.'),
    week_blocks: weekBlocks,
    days,
  };
}

function sanitiseWeekBlocks(blocks: Phase['week_blocks'], old: Phase | null): Phase['week_blocks'] {
  const cleaned = (blocks ?? [])
    .map((block) => ({
      weeks: Number(block.weeks),
      sets: block.sets ? String(block.sets) : undefined,
      weight_pct: block.weight_pct ? String(block.weight_pct) : undefined,
    }))
    .filter((block) => Number.isFinite(block.weeks) && block.weeks > 0 && (block.sets || block.weight_pct));
  if (cleaned.length > 0) return cleaned;
  if (old?.week_blocks && old.week_blocks.length > 0) return old.week_blocks;
  return [{ weeks: Number.parseInt(old?.weeks ?? '4', 10) || 4, sets: '3', weight_pct: inferDefaultPct(old?.title ?? '') }];
}

function inferDefaultPct(title: string): string | undefined {
  const lower = title.toLowerCase();
  if (lower.includes('hypertrophy')) return '65%';
  if (lower.includes('strength')) return '77%';
  return undefined;
}

function totalWeeks(blocks: Phase['week_blocks']) {
  return String((blocks ?? []).reduce((sum, block) => sum + (Number(block.weeks) || 0), 0) || 4);
}

function buildOneRmMap(rows: unknown[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const r = row as { exercise_name?: string; estimated_1rm_kg?: number | null; tested_weight_kg?: number | null };
    const canonical = matchCanonical(r.exercise_name ?? '');
    const value = Number(r.estimated_1rm_kg ?? r.tested_weight_kg ?? 0);
    if (!canonical || !Number.isFinite(value) || value <= 0) continue;
    out[canonical] = Math.max(out[canonical] ?? 0, value);
  }
  return out;
}

function resolveLoads(phase: Phase, oneRmMap: Record<string, number>) {
  const out: Array<Record<string, unknown>> = [];
  for (const day of phase.days ?? []) {
    for (const exercise of day.exercises ?? []) {
      const canonical = matchCanonical(exercise.name ?? '');
      const oneRm = canonical ? oneRmMap[canonical] : null;
      if (!canonical || !oneRm) continue;
      for (const [blockIndex, block] of (phase.week_blocks ?? []).entries()) {
        const override = exercise.week_overrides?.find((item) => item.block_index === blockIndex);
        const pct = override?.weight_pct ?? block.weight_pct;
        if (!pct) continue;
        const kg = resolveKgFromPct(String(pct), oneRm);
        if (kg === null) continue;
        out.push({
          exercise_name: exercise.name,
          canonical_exercise: canonical,
          day_title: day.title,
          block_index: blockIndex,
          weight_pct: pct,
          one_rm_kg: oneRm,
          resolved_kg: kg,
        });
      }
    }
  }
  return out;
}

function matchCanonical(name: string): string | null {
  const lower = name.toLowerCase();
  for (const [canonical, aliases] of Object.entries(BIG_5_ALIASES)) {
    if (aliases.some((alias) => lower.includes(alias))) return canonical;
  }
  return null;
}

function resolveKgFromPct(pctStr: string, oneRmKg: number): number | null {
  const pct = Number.parseFloat(pctStr.replace('%', '').trim());
  if (!Number.isFinite(pct) || pct <= 0 || pct > 200) return null;
  return Math.round(oneRmKg * (pct / 100) * 4) / 4;
}

function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bbb\b/g, 'barbell')
    .replace(/\bdb\b/g, 'dumbbell')
    .replace(/\bkb\b/g, 'kettlebell')
    .replace(/\brdl\b/g, 'romanian deadlift')
    .replace(/\bohp\b/g, 'overhead press')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchLibrary(name: string, byNorm: Map<string, LibraryRow>, library: LibraryRow[]): LibraryRow | null {
  const norm = normalise(name);
  if (!norm) return null;
  const exact = byNorm.get(norm);
  if (exact) return exact;
  let best: LibraryRow | null = null;
  let bestLen = 0;
  for (const row of library) {
    const rn = normalise(row.name);
    if ((norm.includes(rn) || rn.includes(norm)) && rn.length > bestLen) {
      best = row;
      bestLen = rn.length;
    }
  }
  return best;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'item';
}

async function claudeText(
  anthropic: Anthropic,
  opts: { system: string; user: string; maxTokens: number },
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 75_000);
  try {
    const msg = await anthropic.messages.create(
      { model: 'claude-sonnet-4-6', max_tokens: opts.maxTokens, system: opts.system, messages: [{ role: 'user', content: opts.user }] },
      { signal: ctrl.signal },
    );
    return (msg.content[0] as { text: string }).text;
  } finally {
    clearTimeout(timer);
  }
}

async function claudeJson<T>(anthropic: Anthropic, opts: { system: string; user: string; maxTokens: number }): Promise<T | null> {
  const text = (await claudeText(anthropic, opts)).trim();
  for (const candidate of jsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed as T;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function jsonCandidates(text: string): string[] {
  const out = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) out.push(fenced[1].trim());
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) out.push(text.slice(start, end + 1));
  return out;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
