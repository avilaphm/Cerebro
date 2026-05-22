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

const SECTIONS = ['Warm Up', 'Workout', 'MetCon', 'Stretches'] as const;

const PARSE_SYSTEM = `You convert a coach's freeform workout/phase text into a structured training phase for Pedro Avila's coaching app (Cerebro).

OUTPUT FORMAT: valid JSON only, this exact shape:
{
  "title": string,                 // phase/workout title, e.g. "Push Day Block" or "Conditioning Phase"
  "focus": string,                 // one short sentence on the intent
  "weeks": string,                 // number of weeks as a string, default "4" if unstated
  "days": [
    {
      "title": string,             // e.g. "Day 1 - Lower Body"
      "focus": string,             // short sentence
      "exercises": [
        {
          "name": string,          // the exercise name as written, normalised (e.g. "Barbell Back Squat")
          "section": "Warm Up" | "Workout" | "MetCon" | "Stretches",
          "sets": string,          // e.g. "3"
          "reps": string,          // e.g. "8-12" or "30 sec"
          "rest": string,          // e.g. "60-90 sec" or ""
          "superset_label": string,// group label for supersets, e.g. "A", "B" — same label = same superset; "" if standalone
          "notes": string          // any cue/instruction from the text, else ""
        }
      ]
    }
  ]
}

RULES:
- Assign every exercise to one of the four sections. If the text does not say, infer: warm-up/activation -> "Warm Up", main lifts and accessories -> "Workout", conditioning/finishers/circuits -> "MetCon", cooldown/stretch/mobility at the end -> "Stretches".
- Preserve the coach's exercise names but normalise obvious shorthand (e.g. "bb squat" -> "Barbell Back Squat", "db press" -> "Dumbbell Bench Press", "rdl" -> "Romanian Deadlift"). Do not invent exercises the text does not mention.
- If the text describes one session with no day breakdown, return a single day.
- Keep it compact. Output ONLY the JSON object, complete and self-closing. No prose, no markdown fence.`;

const RESEARCH_SYSTEM = `You are a strength & conditioning exercise data expert. For each exercise name given, return accurate structured data.

For each exercise return:
- name: exact name from the input list (string)
- primary_muscles: string[] from: Glutes, Hamstrings, Quadriceps, Calves, Core, Lower Back, Upper Back, Lats, Traps, Chest, Shoulders, Biceps, Triceps, Forearms
- secondary_muscles: string[] (same vocabulary)
- equipment: one of bodyweight/barbell/dumbbells/kettlebell/cable machine/resistance band/machine/TRX/foam roller/stability ball, or null
- cues: string[] coaching cues during the movement (max 6)
- setup_cues: string[] setup steps in order (max 6)
- tags: string[] from strength-compound/strength-isolation/core/mobility/cardio/golf/running/pilates
- conditions: string[] conditions this exercise suits (e.g. "lower back pain"), else []

Return ONLY a valid JSON array, complete and self-closing. No markdown. Start with [ end with ].`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const userSupa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await userSupa.auth.getUser();
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json() as { text?: string };
    const text = (body.text ?? '').trim();
    if (text.length < 10) return json({ error: 'Provide at least a sentence of workout text.' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });

    // STEP 1: parse the freeform text into a structured phase intent.
    const parsed = await claudeJson<ParsedPhase>(anthropic, {
      system: PARSE_SYSTEM,
      user: `COACH TEXT:\n${text.slice(0, 20000)}\n\nOutput the phase JSON now.`,
      maxTokens: 4096,
    });
    if (!parsed || !Array.isArray(parsed.days)) {
      return json({ error: 'Could not parse the workout text into a structure.' }, 502);
    }

    // STEP 2: load the library and match every parsed exercise name.
    const { data: libRows, error: libErr } = await admin
      .from('pt_exercises')
      .select('id, name, video_url, cues, primary_muscles, secondary_muscles, muscles');
    if (libErr) return json({ error: `Library load failed: ${libErr.message}` }, 500);
    const library = (libRows ?? []) as LibraryRow[];
    const byNorm = new Map<string, LibraryRow>();
    for (const row of library) byNorm.set(normalise(row.name), row);

    const parsedExercises = parsed.days.flatMap((d) => (Array.isArray(d.exercises) ? d.exercises : []));
    const uniqueNames = [...new Set(parsedExercises.map((e) => (e.name ?? '').trim()).filter(Boolean))];

    const resolved = new Map<string, LibraryRow>();
    const missing: string[] = [];
    for (const name of uniqueNames) {
      const hit = matchLibrary(name, byNorm, library);
      if (hit) resolved.set(name, hit);
      else missing.push(name);
    }

    // STEP 3: research + create cards for anything missing, then add them to the resolved map.
    const created: Array<{ name: string; exercise_id: string }> = [];
    if (missing.length > 0) {
      const details = await claudeJsonArray<ResearchedExercise>(anthropic, {
        system: RESEARCH_SYSTEM,
        user: `Exercise names:\n${missing.join('\n')}\n\nReturn the JSON array now.`,
        maxTokens: 4096,
      }) ?? [];
      const detailByNorm = new Map<string, ResearchedExercise>();
      for (const d of details) if (d?.name) detailByNorm.set(normalise(d.name), d);

      const toInsert = missing.map((name) => {
        const d = detailByNorm.get(normalise(name));
        const primary = d?.primary_muscles ?? [];
        const secondary = d?.secondary_muscles ?? [];
        return {
          name,
          primary_muscles: primary,
          secondary_muscles: secondary,
          muscles: [...primary, ...secondary],
          equipment: d?.equipment ?? null,
          video_url: null,
          cues: d?.cues ?? [],
          setup_cues: d?.setup_cues ?? [],
          tags: d?.tags ?? [],
          conditions: d?.conditions ?? [],
          progression_ids: [] as string[],
          regression_ids: [] as string[],
          purpose: null,
          source: 'ai',
        };
      });

      const { data: inserted, error: insErr } = await admin
        .from('pt_exercises')
        .insert(toInsert)
        .select('id, name, video_url, cues, primary_muscles, secondary_muscles, muscles');
      if (insErr) return json({ error: `Could not create missing exercises: ${insErr.message}` }, 500);
      for (const row of (inserted ?? []) as LibraryRow[]) {
        resolved.set(row.name, row);
        byNorm.set(normalise(row.name), row);
        created.push({ name: row.name, exercise_id: row.id });
      }
    }

    // STEP 4: assemble the phase in canonical section order with library linkage.
    const days = parsed.days.map((day, di) => {
      const rawExercises = Array.isArray(day.exercises) ? day.exercises : [];
      const ordered = rawExercises
        .map((ex, originalIdx) => ({ ex, originalIdx }))
        .sort((a, b) => {
          const sa = sectionRank(a.ex.section);
          const sb = sectionRank(b.ex.section);
          return sa !== sb ? sa - sb : a.originalIdx - b.originalIdx;
        });

      let lastSection = '';
      const exercises = ordered.map(({ ex }, idx) => {
        const name = (ex.name ?? '').trim();
        const row = resolved.get(name) ?? matchLibrary(name, byNorm, library) ?? null;
        const section = SECTIONS.includes(ex.section as typeof SECTIONS[number]) ? ex.section : 'Workout';
        const sectionStart = section !== lastSection ? section : undefined;
        lastSection = section;
        return {
          id: `ex-${di + 1}-${idx + 1}-${slug(name)}`,
          exercise_id: row?.id ?? null,
          name: row?.name ?? name,
          sets: String(ex.sets ?? '3'),
          reps: String(ex.reps ?? '8-12'),
          rest: String(ex.rest ?? ''),
          notes: String(ex.notes ?? ''),
          video_url: row?.video_url ?? null,
          cues: row?.cues ?? [],
          superset_id: ex.superset_label ? `ss-${slug(String(ex.superset_label))}` : null,
          section_start: sectionStart,
        };
      });

      return {
        id: `day-${di + 1}`,
        title: String(day.title ?? `Day ${di + 1}`),
        focus: String(day.focus ?? ''),
        exercises,
      };
    });

    const phase = {
      id: `phase-text-${Date.now()}`,
      title: String(parsed.title ?? 'Custom workout'),
      focus: String(parsed.focus ?? ''),
      weeks: String(parsed.weeks ?? '4'),
      progression: 'Authored from coach text.',
      days,
    };

    return json({
      ok: true,
      phase,
      created_exercises: created,
      matched_count: uniqueNames.length - missing.length,
      missing_count: missing.length,
    });
  } catch (error) {
    console.error('build-workout-from-text error:', error);
    return json({ error: error instanceof Error ? error.message : 'Build failed' }, 500);
  }
});

interface LibraryRow {
  id: string;
  name: string;
  video_url: string | null;
  cues: string[] | null;
  primary_muscles: string[] | null;
  secondary_muscles: string[] | null;
  muscles: string[] | null;
}

interface ParsedExercise {
  name?: string;
  section?: string;
  sets?: string;
  reps?: string;
  rest?: string;
  superset_label?: string;
  notes?: string;
}
interface ParsedDay { title?: string; focus?: string; exercises?: ParsedExercise[] }
interface ParsedPhase { title?: string; focus?: string; weeks?: string; days?: ParsedDay[] }
interface ResearchedExercise {
  name?: string;
  primary_muscles?: string[];
  secondary_muscles?: string[];
  equipment?: string | null;
  cues?: string[];
  setup_cues?: string[];
  tags?: string[];
  conditions?: string[];
}

function sectionRank(section: string | undefined): number {
  const idx = SECTIONS.indexOf((section ?? '') as typeof SECTIONS[number]);
  return idx >= 0 ? idx : 1; // unknown -> treat as Workout
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
  // containment match: library name fully contained in the parsed name or vice versa.
  let best: LibraryRow | null = null;
  let bestLen = 0;
  for (const row of library) {
    const rn = normalise(row.name);
    if (!rn) continue;
    if ((norm.includes(rn) || rn.includes(norm)) && rn.length > bestLen) {
      best = row;
      bestLen = rn.length;
    }
  }
  return best;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'ex';
}

async function claudeText(
  anthropic: Anthropic,
  opts: { system: string; user: string; maxTokens: number },
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const msg = await anthropic.messages.create(
      { model: 'claude-sonnet-4-6', max_tokens: opts.maxTokens, system: opts.system, messages: [{ role: 'user', content: opts.user }] },
      { signal: ctrl.signal },
    );
    return (msg.content[0] as { text: string }).text;
  } finally { clearTimeout(timer); }
}

async function claudeJson<T>(anthropic: Anthropic, opts: { system: string; user: string; maxTokens: number }): Promise<T | null> {
  return repairObject(await claudeText(anthropic, opts)) as T | null;
}

async function claudeJsonArray<T>(anthropic: Anthropic, opts: { system: string; user: string; maxTokens: number }): Promise<T[] | null> {
  return repairArray(await claudeText(anthropic, opts)) as T[] | null;
}

function repairObject(text: string): Record<string, unknown> | null {
  const t = text.trim();
  for (const c of jsonCandidates(t, '{', '}')) {
    try { const v = JSON.parse(c); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch { /* next */ }
  }
  const a = t.indexOf('{');
  if (a !== -1) { try { const v = JSON.parse(closeTruncated(t.slice(a))); if (v && typeof v === 'object') return v; } catch { /* noop */ } }
  return null;
}

function repairArray(text: string): unknown[] | null {
  const t = text.trim();
  for (const c of jsonCandidates(t, '[', ']')) {
    try { const v = JSON.parse(c); if (Array.isArray(v)) return v; } catch { /* next */ }
  }
  const a = t.indexOf('[');
  if (a !== -1) { try { const v = JSON.parse(closeTruncated(t.slice(a))); if (Array.isArray(v)) return v; } catch { /* noop */ } }
  return null;
}

function jsonCandidates(t: string, open: string, close: string): string[] {
  const out = [t];
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) out.push(fenced[1].trim());
  const a = t.indexOf(open);
  const b = t.lastIndexOf(close);
  if (a !== -1 && b > a) out.push(t.slice(a, b + 1));
  return out;
}

// Closes a JSON value cut off mid-stream (model hit max_tokens): tracks string/escape
// state and the open-bracket stack, trims any dangling fragment, appends missing closers.
function closeTruncated(s: string): string {
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
