import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SECTIONS = ['Warm Up', 'Workout', 'MetCon', 'Stretches'] as const;
const MAX_IMAGES = 8;
const MAX_TEXT_CHARS = 30000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const PARSE_SYSTEM = `You extract a client's current training programme from screenshots and/or pasted coach text for Pedro Avila's Cerebro PT app.

Return valid JSON only:
{
  "extracted_text": string,
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
          "notes": string
        }
      ]
    }
  ]
}

Rules:
- Extract the programme that is visible or pasted. Do not invent extra workouts.
- If the source has days/sessions, preserve them as separate days.
- If the source is one workout only, return one day.
- Preserve exercise names and prescription details exactly when visible.
- Normalise obvious shorthand only: BB -> Barbell, DB -> Dumbbell, KB -> Kettlebell, RDL -> Romanian Deadlift, OHP -> Overhead Press.
- Infer section only when needed: activation/warm-up -> Warm Up; main lifts/accessories -> Workout; conditioning/finishers -> MetCon; cooldown/stretching -> Stretches.
- If sets, reps, or rest are not visible, use "" rather than guessing.
- Output only the JSON object. No markdown.`;

const RESEARCH_SYSTEM = `You are a strength and conditioning exercise data expert. For each exercise name given, return accurate structured data.

For each exercise return:
- name: exact name from the input list
- primary_muscles: string[] from: Glutes, Hamstrings, Quadriceps, Calves, Core, Lower Back, Upper Back, Lats, Traps, Chest, Shoulders, Biceps, Triceps, Forearms
- secondary_muscles: string[] using the same vocabulary
- equipment: one of bodyweight/barbell/dumbbells/kettlebell/cable machine/resistance band/machine/TRX/foam roller/stability ball, or null
- cues: string[] coaching cues during the movement, max 6
- setup_cues: string[] setup steps in order, max 6
- tags: string[] from strength-compound/strength-isolation/core/mobility/cardio/golf/running/pilates
- conditions: string[] conditions this exercise suits, else []

Return only a valid JSON array.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicKey) return json({ error: 'ANTHROPIC_API_KEY is not configured.' }, 500);

    const userSupa = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authErr } = await userSupa.auth.getUser();
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json() as ImportRequest;
    const mode = body.mode === 'commit' ? 'commit' : 'preview';
    const text = (body.text ?? '').trim().slice(0, MAX_TEXT_CHARS);
    const images = (body.images ?? []).filter(validImage).slice(0, MAX_IMAGES);
    if (text.length < 5 && images.length === 0) {
      return json({ error: 'Paste workout text or upload at least one screenshot.' }, 400);
    }

    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const admin = createClient(supabaseUrl, serviceKey);

    const parsed = await parseCurrentWorkout(anthropic, text, images);
    if (!parsed || !Array.isArray(parsed.days) || parsed.days.length === 0) {
      return json({ error: 'Could not extract workout days from that source.' }, 502);
    }

    const { data: libRows, error: libErr } = await admin
      .from('pt_exercises')
      .select('id, name, video_url, cues, primary_muscles, secondary_muscles, muscles');
    if (libErr) return json({ error: `Library load failed: ${libErr.message}` }, 500);

    const library = (libRows ?? []) as LibraryRow[];
    const byNorm = new Map<string, LibraryRow>();
    for (const row of library) byNorm.set(normalise(row.name), row);

    const parsedExercises = parsed.days.flatMap((day) => Array.isArray(day.exercises) ? day.exercises : []);
    const uniqueNames = [...new Set(parsedExercises.map((exercise) => (exercise.name ?? '').trim()).filter(Boolean))];
    const resolved = new Map<string, LibraryRow>();
    const missing: string[] = [];

    for (const name of uniqueNames) {
      const hit = matchLibrary(name, byNorm, library);
      if (hit) resolved.set(name, hit);
      else missing.push(name);
    }

    const created: Array<{ name: string; exercise_id: string }> = [];
    if (mode === 'commit' && missing.length > 0) {
      const details = await researchExercises(anthropic, missing);
      const detailByNorm = new Map<string, ResearchedExercise>();
      for (const detail of details) if (detail?.name) detailByNorm.set(normalise(detail.name), detail);

      const toInsert = missing.map((name) => {
        const detail = detailByNorm.get(normalise(name));
        const primary = detail?.primary_muscles ?? [];
        const secondary = detail?.secondary_muscles ?? [];
        return {
          name,
          primary_muscles: primary,
          secondary_muscles: secondary,
          muscles: [...primary, ...secondary],
          equipment: detail?.equipment ?? null,
          video_url: null,
          cues: detail?.cues ?? [],
          setup_cues: detail?.setup_cues ?? [],
          tags: detail?.tags ?? [],
          conditions: detail?.conditions ?? [],
          progression_ids: [] as string[],
          regression_ids: [] as string[],
          purpose: null,
          source: 'ai',
        };
      });

      const { data: inserted, error: insertErr } = await admin
        .from('pt_exercises')
        .upsert(toInsert, { onConflict: 'name' })
        .select('id, name, video_url, cues, primary_muscles, secondary_muscles, muscles');
      if (insertErr) return json({ error: `Could not create missing exercises: ${insertErr.message}` }, 500);

      for (const row of (inserted ?? []) as LibraryRow[]) {
        resolved.set(row.name, row);
        byNorm.set(normalise(row.name), row);
        created.push({ name: row.name, exercise_id: row.id });
      }
    }

    const days = assembleDays(parsed.days, resolved, byNorm, library)
      .filter((day) => day.exercises.length > 0);
    if (days.length === 0) return json({ error: 'The source did not contain any readable exercises.' }, 422);

    return json({
      ok: true,
      mode,
      days,
      extracted_text: parsed.extracted_text ?? '',
      missing_exercises: missing,
      created_exercises: created,
      matched_count: uniqueNames.length - missing.length,
    });
  } catch (error) {
    console.error('import-current-workout error:', error);
    return json({ error: error instanceof Error ? error.message : 'Import failed.' }, 500);
  }
});

interface ImportImage {
  name?: string;
  mime_type?: string;
  base64?: string;
}

interface ImportRequest {
  mode?: 'preview' | 'commit';
  text?: string;
  images?: ImportImage[];
}

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

interface ParsedDay {
  title?: string;
  focus?: string;
  exercises?: ParsedExercise[];
}

interface ParsedWorkout {
  extracted_text?: string;
  days?: ParsedDay[];
}

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

type AnthropicUserContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

function validImage(image: ImportImage): image is Required<ImportImage> {
  return Boolean(image.base64 && image.mime_type?.startsWith('image/'));
}

async function parseCurrentWorkout(anthropic: Anthropic, text: string, images: Required<ImportImage>[]): Promise<ParsedWorkout | null> {
  const content: AnthropicUserContent[] = [];
  if (text) content.push({ type: 'text', text: `PASTED WORKOUT TEXT:\n${text}` });
  for (const image of images) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: image.mime_type,
        data: image.base64.replace(/^data:[^,]+,/, ''),
      },
    });
  }
  content.push({ type: 'text', text: 'Extract the current training programme now. Return only the JSON object.' });

  return repairObject(await claudeText(anthropic, { system: PARSE_SYSTEM, content, maxTokens: 4096 })) as ParsedWorkout | null;
}

async function researchExercises(anthropic: Anthropic, names: string[]): Promise<ResearchedExercise[]> {
  return repairArray(await claudeText(anthropic, {
    system: RESEARCH_SYSTEM,
    content: [{ type: 'text', text: `Exercise names:\n${names.join('\n')}\n\nReturn the JSON array now.` }],
    maxTokens: 4096,
  })) as ResearchedExercise[] | null ?? [];
}

async function claudeText(
  anthropic: Anthropic,
  opts: { system: string; content: AnthropicUserContent[]; maxTokens: number },
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const msg = await anthropic.messages.create(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: opts.maxTokens,
        system: opts.system,
        messages: [{ role: 'user', content: opts.content }],
      },
      { signal: ctrl.signal },
    );
    return msg.content
      .map((part) => part.type === 'text' ? part.text : '')
      .join('\n')
      .trim();
  } finally {
    clearTimeout(timer);
  }
}

function assembleDays(days: ParsedDay[], resolved: Map<string, LibraryRow>, byNorm: Map<string, LibraryRow>, library: LibraryRow[]) {
  return days.map((day, dayIndex) => {
    const rawExercises = Array.isArray(day.exercises) ? day.exercises : [];
    const ordered = rawExercises
      .map((exercise, originalIndex) => ({ exercise, originalIndex }))
      .sort((a, b) => sectionRank(a.exercise.section) - sectionRank(b.exercise.section) || a.originalIndex - b.originalIndex);

    let lastSection = '';
    const exercises = ordered.map(({ exercise }, exerciseIndex) => {
      const name = (exercise.name ?? '').trim();
      const row = resolved.get(name) ?? matchLibrary(name, byNorm, library);
      const section = SECTIONS.includes(exercise.section as typeof SECTIONS[number]) ? exercise.section ?? 'Workout' : 'Workout';
      const sectionStart = section !== lastSection ? section : undefined;
      lastSection = section;
      return {
        id: `current-${dayIndex + 1}-${exerciseIndex + 1}-${slug(name)}`,
        exercise_id: row?.id ?? null,
        name: row?.name ?? name,
        sets: String(exercise.sets ?? ''),
        reps: String(exercise.reps ?? ''),
        rest: String(exercise.rest ?? ''),
        notes: String(exercise.notes ?? ''),
        video_url: row?.video_url ?? null,
        cues: row?.cues ?? [],
        superset_id: exercise.superset_label ? `ss-${slug(String(exercise.superset_label))}` : null,
        section_start: sectionStart,
      };
    });

    return {
      id: `current-day-${dayIndex + 1}`,
      title: String(day.title ?? `Day ${dayIndex + 1}`),
      focus: String(day.focus ?? ''),
      exercises,
    };
  });
}

function sectionRank(section: string | undefined): number {
  const idx = SECTIONS.indexOf((section ?? '') as typeof SECTIONS[number]);
  return idx >= 0 ? idx : 1;
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
    const rowNorm = normalise(row.name);
    if (!rowNorm) continue;
    if ((norm.includes(rowNorm) || rowNorm.includes(norm)) && rowNorm.length > bestLen) {
      best = row;
      bestLen = rowNorm.length;
    }
  }
  return best;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'exercise';
}

function repairObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  for (const candidate of jsonCandidates(trimmed, '{', '}')) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch { /* next */ }
  }
  const first = trimmed.indexOf('{');
  if (first !== -1) {
    try {
      const value = JSON.parse(closeTruncated(trimmed.slice(first)));
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch { /* noop */ }
  }
  return null;
}

function repairArray(text: string): unknown[] | null {
  const trimmed = text.trim();
  for (const candidate of jsonCandidates(trimmed, '[', ']')) {
    try {
      const value = JSON.parse(candidate);
      if (Array.isArray(value)) return value;
    } catch { /* next */ }
  }
  const first = trimmed.indexOf('[');
  if (first !== -1) {
    try {
      const value = JSON.parse(closeTruncated(trimmed.slice(first)));
      if (Array.isArray(value)) return value;
    } catch { /* noop */ }
  }
  return null;
}

function jsonCandidates(text: string, open: string, close: string): string[] {
  const out = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) out.push(fenced[1].trim());
  const first = text.indexOf(open);
  const last = text.lastIndexOf(close);
  if (first !== -1 && last > first) out.push(text.slice(first, last + 1));
  return out;
}

function closeTruncated(value: string): string {
  let inString = false;
  let escaped = false;
  const stack: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') stack.push(char === '{' ? '}' : ']');
    else if (char === '}' || char === ']') stack.pop();
  }
  let out = value;
  if (inString) out += '"';
  out = out.replace(/\s+$/, '').replace(/,\s*$/, '');
  out = out.replace(/,?\s*"[^"]*"\s*:\s*$/, '').replace(/,\s*$/, '');
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i];
  return out;
}
