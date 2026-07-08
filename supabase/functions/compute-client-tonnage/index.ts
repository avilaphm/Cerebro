import { createClient } from 'npm:@supabase/supabase-js@2';

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
const TIME_ZONE = 'Australia/Sydney';
const PATTERN_KEYS = ['push', 'pull', 'hinge', 'squat', 'other'] as const;
const COUNTABLE_PATTERNS = ['push', 'pull', 'hinge', 'squat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type SupabaseAdmin = ReturnType<typeof createClient>;
type PatternKey = typeof PATTERN_KEYS[number];

interface RequestBody {
  client_id?: string;
}

interface LibraryEntry {
  canonical_name: string;
  pattern: string;
  plane: string | null;
  primary_muscle: string;
  load_type: 'external' | 'bodyweight' | 'hybrid';
  bodyweight_factor: number | null;
  tonnage_mode: 'reps_load' | 'time_based' | 'carry' | 'isometric';
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
}

interface RangeSpec {
  period: 'previous_week' | 'current_week' | 'month_to_date';
  startUtc: Date;
  endUtc: Date;
  startParts: LocalParts;
  endParts: LocalParts;
  weekStart?: string;
}

interface SetLogRow {
  id: string;
  workout_log_id: string;
  exercise_name: string;
  reps: number | string | null;
  weight: number | string | null;
}

interface ExcludedRow {
  exercise_name: string;
  reason: string;
  sets: number;
}

interface TonnageSummary {
  period: RangeSpec['period'];
  label: string;
  range_start: string;
  range_end: string;
  week_start: string | null;
  total_kg: number;
  by_pattern: Record<PatternKey, number>;
  by_plane: Record<string, number>;
  by_muscle: Record<string, number>;
  excluded: ExcludedRow[];
  bodyweight_missing: boolean;
  workout_count: number;
  set_count: number;
  computed_at: string;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jwtPayload(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1];
    if (!payload) return {};
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(normalized));
  } catch {
    return {};
  }
}

async function authorize(
  admin: SupabaseAdmin,
  authHeader: string,
  clientId: string | undefined,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (token === serviceKey || jwtPayload(token).role === 'service_role') return { ok: true };

  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return { ok: false, status: 401, error: 'Unauthorized.' };

  const email = data.user.email?.toLowerCase() ?? '';
  const { data: profile } = await admin.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
  if (PEDRO_EMAILS.includes(email) || profile?.role === 'admin') return { ok: true };
  if (!clientId) return { ok: false, status: 400, error: 'client_id is required.' };

  const { data: owned } = await admin
    .from('pt_clients')
    .select('id')
    .eq('id', clientId)
    .eq('user_id', data.user.id)
    .maybeSingle();

  return owned?.id ? { ok: true } : { ok: false, status: 403, error: 'This login is not linked to that client.' };
}

function canonicalKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function emptyPattern(): Record<PatternKey, number> {
  return { push: 0, pull: 0, hinge: 0, squat: 0, other: 0 };
}

function addToRecord(record: Record<string, number>, key: string | null | undefined, amount: number) {
  const cleanKey = key?.trim() || 'other';
  record[cleanKey] = (record[cleanKey] ?? 0) + amount;
}

function roundKg(value: number): number {
  return Math.round(value);
}

function roundRecord(record: Record<string, number>): Record<string, number> {
  const rounded: Record<string, number> = {};
  for (const [key, value] of Object.entries(record)) {
    const next = roundKg(value);
    if (next > 0) rounded[key] = next;
  }
  return rounded;
}

function displayPattern(pattern: string | null | undefined): PatternKey {
  return COUNTABLE_PATTERNS.includes(pattern as typeof COUNTABLE_PATTERNS[number])
    ? pattern as PatternKey
    : 'other';
}

function weekdayNumber(label: string): number {
  const normalized = label.slice(0, 3).toLowerCase();
  if (normalized === 'mon') return 1;
  if (normalized === 'tue') return 2;
  if (normalized === 'wed') return 3;
  if (normalized === 'thu') return 4;
  if (normalized === 'fri') return 5;
  if (normalized === 'sat') return 6;
  return 0;
}

function localParts(date: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(byType.get('year')),
    month: Number(byType.get('month')),
    day: Number(byType.get('day')),
    weekday: weekdayNumber(byType.get('weekday') ?? 'Sun'),
  };
}

function addLocalDays(parts: LocalParts, days: number): LocalParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
  };
}

function localDateString(parts: Pick<LocalParts, 'year' | 'month' | 'day'>): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function offsetMinutes(timeZone: string, date: Date): number {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date).find((item) => item.type === 'timeZoneName')?.value ?? 'GMT';
  if (part === 'GMT' || part === 'UTC') return 0;
  const match = part.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? 0);
  return sign * (hours * 60 + minutes);
}

function zonedTimeToUtc(parts: Pick<LocalParts, 'year' | 'month' | 'day'>, timeZone: string): Date {
  const utcGuess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0));
  const firstOffset = offsetMinutes(timeZone, utcGuess);
  const firstUtc = new Date(utcGuess.getTime() - firstOffset * 60_000);
  const correctedOffset = offsetMinutes(timeZone, firstUtc);
  return new Date(utcGuess.getTime() - correctedOffset * 60_000);
}

function rangeLabel(start: LocalParts, end: LocalParts): string {
  const startLabel = `${start.day} ${MONTHS[start.month - 1]}`;
  const endLabel = `${end.day} ${MONTHS[end.month - 1]}`;
  return start.year === end.year ? `${startLabel} - ${endLabel}` : `${startLabel} ${start.year} - ${endLabel} ${end.year}`;
}

function buildRanges(now: Date, timeZone: string): { previous: RangeSpec; current: RangeSpec; monthToDate: RangeSpec } {
  const nowParts = localParts(now, timeZone);
  const daysSinceMonday = nowParts.weekday === 0 ? 6 : nowParts.weekday - 1;
  const currentWeekStartParts = addLocalDays(nowParts, -daysSinceMonday);
  const previousWeekStartParts = addLocalDays(currentWeekStartParts, -7);
  const previousWeekEndParts = addLocalDays(currentWeekStartParts, -1);
  const monthStartParts = { ...nowParts, day: 1, weekday: 0 };

  return {
    previous: {
      period: 'previous_week',
      startUtc: zonedTimeToUtc(previousWeekStartParts, timeZone),
      endUtc: zonedTimeToUtc(currentWeekStartParts, timeZone),
      startParts: previousWeekStartParts,
      endParts: previousWeekEndParts,
      weekStart: localDateString(previousWeekStartParts),
    },
    current: {
      period: 'current_week',
      startUtc: zonedTimeToUtc(currentWeekStartParts, timeZone),
      endUtc: now,
      startParts: currentWeekStartParts,
      endParts: nowParts,
      weekStart: localDateString(currentWeekStartParts),
    },
    monthToDate: {
      period: 'month_to_date',
      startUtc: zonedTimeToUtc(monthStartParts, timeZone),
      endUtc: now,
      startParts: monthStartParts,
      endParts: nowParts,
    },
  };
}

async function loadLibrary(admin: SupabaseAdmin): Promise<Map<string, LibraryEntry>> {
  const entries = new Map<string, LibraryEntry>();
  const pageSize = 1000;

  for (let start = 0; ; start += pageSize) {
    const { data, error } = await admin
      .from('exercise_library')
      .select('canonical_name, canonical_key, aliases, pattern, plane, primary_muscle, load_type, bodyweight_factor, tonnage_mode')
      .range(start, start + pageSize - 1);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const entry: LibraryEntry = {
        canonical_name: String(row.canonical_name ?? 'Unknown exercise'),
        pattern: String(row.pattern ?? 'other'),
        plane: typeof row.plane === 'string' ? row.plane : null,
        primary_muscle: String(row.primary_muscle ?? 'other'),
        load_type: ['external', 'bodyweight', 'hybrid'].includes(String(row.load_type))
          ? String(row.load_type) as LibraryEntry['load_type']
          : 'external',
        bodyweight_factor: numberOrNull(row.bodyweight_factor),
        tonnage_mode: ['reps_load', 'time_based', 'carry', 'isometric'].includes(String(row.tonnage_mode))
          ? String(row.tonnage_mode) as LibraryEntry['tonnage_mode']
          : 'reps_load',
      };

      const keys = [String(row.canonical_key ?? canonicalKey(entry.canonical_name))];
      if (Array.isArray(row.aliases)) {
        keys.push(...row.aliases.filter((alias): alias is string => typeof alias === 'string').map(canonicalKey));
      }
      for (const key of keys.filter(Boolean)) entries.set(key, entry);
    }

    if (rows.length < pageSize) break;
  }

  return entries;
}

async function loadBodyweight(admin: SupabaseAdmin, clientId: string): Promise<{ kg: number | null; source: string | null }> {
  const [{ data: metric }, { data: client }] = await Promise.all([
    admin
      .from('pt_client_metrics')
      .select('weight_kg, measured_at, created_at')
      .eq('client_id', clientId)
      .not('weight_kg', 'is', null)
      .order('measured_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from('pt_clients').select('current_weight_kg').eq('id', clientId).maybeSingle(),
  ]);

  const metricKg = numberOrNull(metric?.weight_kg);
  if (metricKg && metricKg > 0) return { kg: metricKg, source: 'metric' };
  const clientKg = numberOrNull(client?.current_weight_kg);
  if (clientKg && clientKg > 0) return { kg: clientKg, source: 'client_profile' };
  return { kg: null, source: null };
}

async function loadWorkoutIds(admin: SupabaseAdmin, clientId: string, range: RangeSpec): Promise<string[]> {
  const { data, error } = await admin
    .from('pt_workout_logs')
    .select('id')
    .eq('client_id', clientId)
    .gte('completed_at', range.startUtc.toISOString())
    .lt('completed_at', range.endUtc.toISOString())
    .order('completed_at', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

async function loadSetLogs(admin: SupabaseAdmin, workoutIds: string[]): Promise<SetLogRow[]> {
  if (workoutIds.length === 0) return [];
  const rows: SetLogRow[] = [];
  const pageSize = 1000;

  for (const idChunk of chunks(workoutIds, 100)) {
    for (let start = 0; ; start += pageSize) {
      const { data, error } = await admin
        .from('pt_set_logs')
        .select('id, workout_log_id, exercise_name, reps, weight')
        .in('workout_log_id', idChunk)
        .order('created_at', { ascending: true })
        .range(start, start + pageSize - 1);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as SetLogRow[];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
  }

  return rows;
}

function addExcluded(excluded: Map<string, ExcludedRow>, exerciseName: string, reason: string) {
  const key = `${canonicalKey(exerciseName)}:${reason}`;
  const current = excluded.get(key);
  if (current) {
    current.sets += 1;
  } else {
    excluded.set(key, { exercise_name: exerciseName, reason, sets: 1 });
  }
}

async function computeRange(
  admin: SupabaseAdmin,
  clientId: string,
  range: RangeSpec,
  library: Map<string, LibraryEntry>,
  bodyweight: { kg: number | null },
): Promise<TonnageSummary> {
  const workoutIds = await loadWorkoutIds(admin, clientId, range);
  const setLogs = await loadSetLogs(admin, workoutIds);
  const byPattern = emptyPattern();
  const byPlane: Record<string, number> = {};
  const byMuscle: Record<string, number> = {};
  const excluded = new Map<string, ExcludedRow>();
  let total = 0;
  let countedSets = 0;
  let bodyweightMissing = false;

  for (const set of setLogs) {
    const exerciseName = set.exercise_name?.trim() || 'Unknown exercise';
    const entry = library.get(canonicalKey(exerciseName)) ?? {
      canonical_name: exerciseName,
      pattern: 'other',
      plane: null,
      primary_muscle: 'other',
      load_type: 'external',
      bodyweight_factor: null,
      tonnage_mode: 'reps_load',
    };

    if (entry.tonnage_mode !== 'reps_load') {
      addExcluded(excluded, exerciseName, entry.tonnage_mode);
      continue;
    }

    const reps = numberOrNull(set.reps);
    if (!reps || reps <= 0) {
      addExcluded(excluded, exerciseName, 'missing_reps');
      continue;
    }

    const loggedWeight = numberOrNull(set.weight);
    let effectiveLoad = 0;

    if (entry.load_type === 'external') {
      if (!loggedWeight || loggedWeight <= 0) {
        addExcluded(excluded, exerciseName, 'missing_weight');
        continue;
      }
      effectiveLoad = loggedWeight;
    } else {
      const factor = entry.bodyweight_factor ?? 1;
      if (!bodyweight.kg) bodyweightMissing = true;
      effectiveLoad = (bodyweight.kg ?? 0) * factor;
      if (entry.load_type === 'hybrid') effectiveLoad += loggedWeight ?? 0;
    }

    const kg = effectiveLoad * reps;
    if (kg <= 0) continue;

    countedSets += 1;
    total += kg;
    const pattern = displayPattern(entry.pattern);
    byPattern[pattern] += kg;
    addToRecord(byMuscle, entry.primary_muscle, kg);
    if (entry.plane && (pattern === 'push' || pattern === 'pull')) {
      addToRecord(byPlane, `${entry.plane}_${pattern}`, kg);
    }
  }

  return {
    period: range.period,
    label: rangeLabel(range.startParts, range.endParts),
    range_start: range.startUtc.toISOString(),
    range_end: range.endUtc.toISOString(),
    week_start: range.weekStart ?? null,
    total_kg: roundKg(total),
    by_pattern: {
      push: roundKg(byPattern.push),
      pull: roundKg(byPattern.pull),
      hinge: roundKg(byPattern.hinge),
      squat: roundKg(byPattern.squat),
      other: roundKg(byPattern.other),
    },
    by_plane: roundRecord(byPlane),
    by_muscle: roundRecord(byMuscle),
    excluded: Array.from(excluded.values()).sort((a, b) => b.sets - a.sets),
    bodyweight_missing: bodyweightMissing,
    workout_count: workoutIds.length,
    set_count: countedSets,
    computed_at: new Date().toISOString(),
  };
}

async function upsertWeekly(admin: SupabaseAdmin, clientId: string, summary: TonnageSummary) {
  if (!summary.week_start) return;
  const { error } = await admin.from('weekly_tonnage').upsert({
    client_id: clientId,
    week_start: summary.week_start,
    timezone: TIME_ZONE,
    range_start: summary.range_start,
    range_end: summary.range_end,
    total_kg: summary.total_kg,
    by_pattern: summary.by_pattern,
    by_plane: summary.by_plane,
    by_muscle: summary.by_muscle,
    excluded: summary.excluded,
    bodyweight_missing: summary.bodyweight_missing,
    workout_count: summary.workout_count,
    set_count: summary.set_count,
    computed_at: summary.computed_at,
    updated_at: summary.computed_at,
  }, { onConflict: 'client_id,week_start' });

  if (error) console.warn('Could not upsert weekly_tonnage', error.message);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ ok: false, error: 'Missing authorization.' }, 401);

    const body = (await req.json().catch(() => ({}))) as RequestBody;
    if (!body.client_id) return json({ ok: false, error: 'client_id is required.' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const authz = await authorize(admin, authHeader, body.client_id);
    if (!authz.ok) return json({ ok: false, error: authz.error }, authz.status);

    const now = new Date();
    const ranges = buildRanges(now, TIME_ZONE);
    const [library, bodyweight] = await Promise.all([
      loadLibrary(admin),
      loadBodyweight(admin, body.client_id),
    ]);

    const previousWeek = await computeRange(admin, body.client_id, ranges.previous, library, bodyweight);
    const currentWeek = await computeRange(admin, body.client_id, ranges.current, library, bodyweight);
    const monthToDate = await computeRange(admin, body.client_id, ranges.monthToDate, library, bodyweight);

    await Promise.all([
      upsertWeekly(admin, body.client_id, previousWeek),
      upsertWeekly(admin, body.client_id, currentWeek),
    ]);

    return json({
      ok: true,
      timezone: TIME_ZONE,
      bodyweight_source: bodyweight.source,
      previous_week: previousWeek,
      current_week: currentWeek,
      month_to_date: monthToDate,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error.';
    console.error('compute-client-tonnage failed', error);
    return json({ ok: false, error: message }, 500);
  }
});
