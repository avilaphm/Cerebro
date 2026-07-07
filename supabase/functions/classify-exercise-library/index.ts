import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PEDRO_EMAILS = [
  'pedro@meetavila.com',
  'pedroavila.phm@gmail.com',
  'pedro@cerebroai.au',
  'avila.phm@gmail.com',
];

const PATTERNS = ['push', 'pull', 'hinge', 'squat', 'carry', 'core', 'other'] as const;
const PLANES = ['vertical', 'horizontal'] as const;
const LOAD_TYPES = ['external', 'bodyweight', 'hybrid'] as const;
const TONNAGE_MODES = ['reps_load', 'time_based', 'carry', 'isometric'] as const;
const MUSCLES = [
  'chest',
  'back',
  'shoulders',
  'triceps',
  'biceps',
  'forearms',
  'quadriceps',
  'hamstrings',
  'glutes',
  'calves',
  'core',
  'lower back',
  'adductors',
  'abductors',
  'other',
] as const;
const CONFIDENCE_THRESHOLD = 0.75;
const BATCH_SIZE = 20;

type Pattern = typeof PATTERNS[number];
type Plane = typeof PLANES[number];
type LoadType = typeof LOAD_TYPES[number];
type TonnageMode = typeof TONNAGE_MODES[number];
type Muscle = typeof MUSCLES[number];
type SupabaseAdmin = ReturnType<typeof createClient>;

interface RequestBody {
  client_id?: string;
  workout_log_id?: string;
  exercise_names?: string[];
  backfill?: boolean;
  limit?: number;
  max_new?: number;
}

interface Candidate {
  name: string;
  key: string;
  sourceExerciseId: string | null;
  source: Record<string, unknown> | null;
}

interface ClassifiedExercise {
  exercise_name?: unknown;
  canonical_name?: unknown;
  aliases?: unknown;
  pattern?: unknown;
  plane?: unknown;
  primary_muscle?: unknown;
  secondary_muscles?: unknown;
  load_type?: unknown;
  bodyweight_factor?: unknown;
  tonnage_mode?: unknown;
  confidence?: unknown;
}

interface LibraryRow {
  canonical_name: string;
  canonical_key: string;
  aliases: string[];
  source_exercise_id: string | null;
  pattern: Pattern;
  plane: Plane | null;
  primary_muscle: Muscle;
  secondary_muscles: Muscle[];
  load_type: LoadType;
  bodyweight_factor: number | null;
  tonnage_mode: TonnageMode;
  classified_by: 'ai';
  confidence: number | null;
  locked: false;
  needs_review: boolean;
  review_reason: string | null;
  updated_at: string;
  last_classified_at: string;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function canonicalKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const next = text(value);
    if (!next) continue;
    const key = canonicalKey(next);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return out;
}

function jwtPayload(jwt: string): Record<string, unknown> {
  try {
    return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
  }
}

async function authorize(
  admin: SupabaseAdmin,
  authHeader: string,
  clientId: string | undefined,
  adminOnly: boolean,
): Promise<{ ok: true; admin: boolean } | { ok: false; status: number; error: string }> {
  const token = authHeader.replace('Bearer ', '');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (token === serviceKey || jwtPayload(token).role === 'service_role') return { ok: true, admin: true };

  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return { ok: false, status: 401, error: 'Unauthorized.' };

  const email = data.user.email?.toLowerCase() ?? '';
  const { data: profile } = await admin.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
  const isAdmin = PEDRO_EMAILS.includes(email) || profile?.role === 'admin';
  if (isAdmin) return { ok: true, admin: true };
  if (adminOnly) return { ok: false, status: 403, error: 'Only Pedro can run exercise-library backfills.' };
  if (!clientId) return { ok: false, status: 400, error: 'client_id is required.' };

  const { data: owned } = await admin
    .from('pt_clients')
    .select('id')
    .eq('id', clientId)
    .eq('user_id', data.user.id)
    .maybeSingle();

  return owned?.id ? { ok: true, admin: false } : { ok: false, status: 403, error: 'This login is not linked to that client.' };
}

async function collectCandidates(admin: SupabaseAdmin, body: RequestBody): Promise<Candidate[]> {
  const nameRows: Array<{ exercise_name: string; exercise_id: string | null }> = [];

  if (body.backfill) {
    const limit = Math.min(Math.max(Number(body.limit ?? 5000), 1), 20000);
    const pageSize = 1000;
    for (let start = 0; start < limit; start += pageSize) {
      const end = Math.min(start + pageSize - 1, limit - 1);
      const { data, error } = await admin
        .from('pt_set_logs')
        .select('exercise_name, exercise_id')
        .not('exercise_name', 'is', null)
        .order('created_at', { ascending: false })
        .range(start, end);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as Array<{ exercise_name: string; exercise_id: string | null }>;
      nameRows.push(...page);
      if (page.length < end - start + 1) break;
    }
  }

  if (body.workout_log_id) {
    let query = admin
      .from('pt_set_logs')
      .select('exercise_name, exercise_id')
      .eq('workout_log_id', body.workout_log_id);
    if (body.client_id) query = query.eq('client_id', body.client_id);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    nameRows.push(...((data ?? []) as Array<{ exercise_name: string; exercise_id: string | null }>));
  }

  for (const name of body.exercise_names ?? []) {
    if (typeof name === 'string') nameRows.push({ exercise_name: name, exercise_id: null });
  }

  const byKey = new Map<string, Candidate>();
  for (const row of nameRows) {
    const name = text(row.exercise_name);
    const key = canonicalKey(name);
    if (!name || !key || byKey.has(key)) continue;
    byKey.set(key, { name, key, sourceExerciseId: row.exercise_id ?? null, source: null });
  }

  const candidates = Array.from(byKey.values());
  const ids = candidates.map((candidate) => candidate.sourceExerciseId).filter((id): id is string => !!id);
  if (ids.length > 0) {
    const { data } = await admin
      .from('pt_exercises')
      .select('id, name, equipment, muscles, primary_muscles, secondary_muscles, tags')
      .in('id', Array.from(new Set(ids)));
    const byId = new Map((data ?? []).map((row: Record<string, unknown> & { id: string }) => [row.id, row]));
    for (const candidate of candidates) {
      if (candidate.sourceExerciseId) candidate.source = byId.get(candidate.sourceExerciseId) ?? null;
    }
  }

  return candidates;
}

async function filterExisting(admin: SupabaseAdmin, candidates: Candidate[]) {
  if (candidates.length === 0) return { existing: 0, missing: [] as Candidate[] };
  const { data, error } = await admin
    .from('exercise_library')
    .select('canonical_key, aliases')
    .range(0, 9999);
  if (error) throw new Error(error.message);

  const existingKeys = new Set<string>();
  for (const row of data ?? []) {
    const record = row as { canonical_key?: string; aliases?: unknown };
    if (record.canonical_key) existingKeys.add(record.canonical_key);
    if (Array.isArray(record.aliases)) {
      for (const alias of record.aliases) {
        const key = canonicalKey(text(alias));
        if (key) existingKeys.add(key);
      }
    }
  }

  const missing = candidates.filter((candidate) => !existingKeys.has(candidate.key));
  return { existing: candidates.length - missing.length, missing };
}

function parseJsonArray(raw: string): ClassifiedExercise[] | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed as ClassifiedExercise[] : null;
  } catch {
    const match = trimmed.match(/\[[\s\S]*\]/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed as ClassifiedExercise[] : null;
    } catch {
      return null;
    }
  }
}

const CLASSIFICATION_PROMPT = `You classify exercises for a deterministic weekly kilos-moved calculator.
Return ONLY valid JSON array. No markdown, no explanation.

Schema for every input item:
{
  "exercise_name": "exact input exercise_name",
  "canonical_name": "clean common exercise name",
  "aliases": ["common variants, include the original name if useful"],
  "pattern": "push|pull|hinge|squat|carry|core|other",
  "plane": "vertical|horizontal|null",
  "primary_muscle": "chest|back|shoulders|triceps|biceps|forearms|quadriceps|hamstrings|glutes|calves|core|lower back|adductors|abductors|other",
  "secondary_muscles": ["same muscle vocabulary"],
  "load_type": "external|bodyweight|hybrid",
  "bodyweight_factor": number_or_null,
  "tonnage_mode": "reps_load|time_based|carry|isometric",
  "confidence": 0_to_1
}

Rules:
- The calculator later uses weight x reps. Do not do any tonnage math here.
- pattern push: presses, push-ups, dips, flyes, triceps-dominant pressing.
- pattern pull: rows, pulldowns, pull-ups/chin-ups, curls, rear-delt/face-pull style pulls.
- pattern hinge: deadlifts, RDLs, hip thrusts, good mornings, swings, leg curls.
- pattern squat: squats, lunges, split squats, step-ups, leg press, leg extension.
- pattern carry: farmer/suitcase/front rack carries. Set tonnage_mode "carry".
- pattern core: planks, dead bugs, pallof press, anti-rotation, crunches, rotations.
- plane applies only to push/pull: horizontal for bench/push-up/row/fly, vertical for overhead press/pulldown/pull-up. Otherwise null.
- load_type external: logged external weight is the load.
- load_type bodyweight: bodyweight is the load basis.
- load_type hybrid: bodyweight plus added external load, e.g. weighted pull-up/dip/push-up.
- bodyweight_factor examples: push-up 0.65, pull-up/chin-up 1.0, dip 0.9, inverted row 0.6, bodyweight squat/lunge/split squat 0.85, plank/dead bug/null if not reps_load.
- time-based cardio/mobility uses tonnage_mode "time_based".
- holds/planks/wall sits use tonnage_mode "isometric".
- If uncertain or the name is too vague, use pattern "other", primary_muscle "other", confidence below 0.75.
- Prefer simple lower-case muscle names from the allowed list.`;

async function classifyBatch(anthropic: Anthropic, candidates: Candidate[]): Promise<ClassifiedExercise[]> {
  const response = await anthropic.messages.create({
    model: Deno.env.get('EXERCISE_CLASSIFICATION_MODEL') ?? 'claude-sonnet-4-6',
    max_tokens: 5000,
    system: CLASSIFICATION_PROMPT,
    messages: [{
      role: 'user',
      content: JSON.stringify(candidates.map((candidate) => ({
        exercise_name: candidate.name,
        source_exercise: candidate.source,
      }))),
    }],
  });
  const raw = response.content[0]?.type === 'text' ? response.content[0].text : '';
  const parsed = parseJsonArray(raw);
  if (!parsed) throw new Error(`Could not parse classifier JSON: ${raw.slice(0, 300)}`);
  return parsed;
}

async function upsertRows(admin: SupabaseAdmin, rows: LibraryRow[]) {
  if (rows.length === 0) return 0;
  const { data, error } = await admin
    .from('exercise_library')
    .upsert(rows, { onConflict: 'canonical_key' })
    .select('id');
  if (error) throw new Error(error.message);
  return data?.length ?? rows.length;
}

function isOneOf<T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function numberOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(2, value));
}

function muscleList(value: unknown): Muscle[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Muscle => isOneOf(item, MUSCLES));
}

function fallbackRow(candidate: Candidate, reason: string): LibraryRow {
  const now = new Date().toISOString();
  return {
    canonical_name: candidate.name,
    canonical_key: candidate.key,
    aliases: [candidate.name],
    source_exercise_id: candidate.sourceExerciseId,
    pattern: 'other',
    plane: null,
    primary_muscle: 'other',
    secondary_muscles: [],
    load_type: 'external',
    bodyweight_factor: null,
    tonnage_mode: 'reps_load',
    classified_by: 'ai',
    confidence: null,
    locked: false,
    needs_review: true,
    review_reason: reason,
    updated_at: now,
    last_classified_at: now,
  };
}

function toLibraryRow(candidate: Candidate, classified: ClassifiedExercise | undefined): LibraryRow {
  if (!classified) return fallbackRow(candidate, 'AI did not return this exercise.');

  const confidence = numberOrNull(classified.confidence);
  if (confidence === null || confidence < CONFIDENCE_THRESHOLD) {
    return {
      ...fallbackRow(candidate, `Low classifier confidence${confidence === null ? '' : ` (${confidence.toFixed(2)})`}.`),
      confidence,
    };
  }

  const canonicalName = text(classified.canonical_name, candidate.name) || candidate.name;
  const pattern = isOneOf(classified.pattern, PATTERNS) ? classified.pattern : 'other';
  const loadType = isOneOf(classified.load_type, LOAD_TYPES) ? classified.load_type : 'external';
  const tonnageMode = isOneOf(classified.tonnage_mode, TONNAGE_MODES) ? classified.tonnage_mode : 'reps_load';
  const now = new Date().toISOString();

  return {
    canonical_name: canonicalName,
    canonical_key: candidate.key,
    aliases: uniqueStrings([
      candidate.name,
      canonicalName,
      ...(Array.isArray(classified.aliases) ? classified.aliases : []),
    ]),
    source_exercise_id: candidate.sourceExerciseId,
    pattern,
    plane: isOneOf(classified.plane, PLANES) ? classified.plane : null,
    primary_muscle: isOneOf(classified.primary_muscle, MUSCLES) ? classified.primary_muscle : 'other',
    secondary_muscles: muscleList(classified.secondary_muscles),
    load_type: loadType,
    bodyweight_factor: loadType === 'external' ? null : numberOrNull(classified.bodyweight_factor),
    tonnage_mode: pattern === 'carry' ? 'carry' : tonnageMode,
    classified_by: 'ai',
    confidence,
    locked: false,
    needs_review: false,
    review_reason: null,
    updated_at: now,
    last_classified_at: now,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ ok: false, error: 'Missing authorization.' }, 401);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const authz = await authorize(admin, authHeader, body.client_id, body.backfill === true);
    if (!authz.ok) return json({ ok: false, error: authz.error }, authz.status);

    const candidates = await collectCandidates(admin, body);
    const { existing, missing } = await filterExisting(admin, candidates);
    const maxNew = Math.min(Math.max(Number(body.max_new ?? missing.length), 1), 100);
    const toClassify = missing.slice(0, maxNew);
    if (toClassify.length === 0) {
      return json({ ok: true, candidates: candidates.length, existing, classified: 0, needs_review: 0 });
    }

    let classifiedCount = 0;
    let needsReviewCount = 0;
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicKey) {
      const rows = toClassify.map((candidate) => fallbackRow(candidate, 'ANTHROPIC_API_KEY is not configured.'));
      classifiedCount += await upsertRows(admin, rows);
      needsReviewCount += rows.filter((row) => row.needs_review).length;
    } else {
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      for (let i = 0; i < toClassify.length; i += BATCH_SIZE) {
        const batch = toClassify.slice(i, i + BATCH_SIZE);
        let rows: LibraryRow[];
        try {
          const classified = await classifyBatch(anthropic, batch);
          const byInputName = new Map(
            classified.map((item) => [canonicalKey(text(item.exercise_name)), item]),
          );
          rows = batch.map((candidate) => toLibraryRow(candidate, byInputName.get(candidate.key)));
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'AI classification failed.';
          rows = batch.map((candidate) => fallbackRow(candidate, reason.slice(0, 500)));
        }
        classifiedCount += await upsertRows(admin, rows);
        needsReviewCount += rows.filter((row) => row.needs_review).length;
      }
    }

    return json({
      ok: true,
      candidates: candidates.length,
      existing,
      remaining_after_this_run: Math.max(0, missing.length - toClassify.length),
      classified: classifiedCount,
      needs_review: needsReviewCount,
    });
  } catch (error) {
    console.error('classify-exercise-library error:', error);
    return json({ ok: false, error: error instanceof Error ? error.message : 'Exercise classification failed.' }, 500);
  }
});
