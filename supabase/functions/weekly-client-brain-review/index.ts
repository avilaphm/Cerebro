import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PEDRO_EMAILS = ['pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com'];
const DEFAULT_CRON_TOKEN = 'cerebro-cron-2026';

interface RequestBody {
  client_id?: string;
  week_start?: string;
}

interface WeeklyReport {
  coach_summary: string;
  client_summary: string;
  nutrition_summary: string;
  training_summary: string;
  flags: string[];
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization.' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicKey) return json({ error: 'ANTHROPIC_API_KEY is required.' }, 500);

    const admin = createClient(supabaseUrl, serviceKey);
    const authz = await authorize(req, supabaseUrl, anonKey, admin, authHeader);
    if (!authz.ok) return json({ error: authz.error }, authz.status);

    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const weekStart = normalizeWeekStart(body.week_start);
    const weekEnd = addDays(weekStart, 6);
    const clients = await loadClients(admin, body.client_id);
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    const results = [];
    for (const client of clients) {
      const snapshot = await buildSnapshot(admin, client, weekStart, weekEnd);
      const report = await generateReport(anthropic, snapshot);
      const { data, error } = await admin
        .from('pt_client_brain_reports')
        .upsert({
          client_id: client.id,
          week_start: weekStart,
          week_end: weekEnd,
          report_type: 'weekly',
          source_snapshot: snapshot,
          coach_summary: report.coach_summary,
          client_summary: report.client_summary,
          nutrition_summary: report.nutrition_summary,
          training_summary: report.training_summary,
          flags: report.flags,
          applied_to_brain: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'client_id,week_start,report_type' })
        .select('id')
        .single();
      if (error) {
        results.push({ client_id: client.id, ok: false, error: error.message });
        continue;
      }

      await Promise.allSettled([
        admin
          .from('pt_client_brain')
          .update({
            summary_current: report.coach_summary,
            summary_30d: report.client_summary,
            updated_at: new Date().toISOString(),
          })
          .eq('client_id', client.id),
        admin
          .from('pt_client_nutrition_doc')
          .update({
            last_12m_summary: report.nutrition_summary,
            updated_at: new Date().toISOString(),
          })
          .eq('client_id', client.id),
        admin
          .from('pt_client_exercise_doc')
          .update({
            current_week_summary: report.training_summary,
            updated_at: new Date().toISOString(),
          })
          .eq('client_id', client.id),
        callInternalFunction(supabaseUrl, serviceKey, 'embed-client-brain', { client_id: client.id }),
      ]);

      results.push({ client_id: client.id, report_id: data?.id, ok: true });
    }

    return json({ ok: true, week_start: weekStart, week_end: weekEnd, processed: results.length, results });
  } catch (error) {
    console.error('weekly-client-brain-review error:', error);
    return json({ error: error instanceof Error ? error.message : 'Weekly brain review failed.' }, 500);
  }
});

async function authorize(
  req: Request,
  supabaseUrl: string,
  anonKey: string,
  admin: ReturnType<typeof createClient>,
  authHeader: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const token = authHeader.replace('Bearer ', '');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (token === serviceKey || token === (Deno.env.get('PT_WEEKLY_REVIEW_CRON_TOKEN') ?? DEFAULT_CRON_TOKEN)) return { ok: true };

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return { ok: false, error: 'Unauthorized.', status: 401 };
  const email = data.user.email?.toLowerCase() ?? '';
  const { data: profile } = await admin.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
  if (PEDRO_EMAILS.includes(email) || profile?.role === 'admin') return { ok: true };
  return { ok: false, error: 'Only Pedro can generate weekly brain reports.', status: 403 };
}

async function loadClients(admin: ReturnType<typeof createClient>, clientId?: string) {
  let query = admin.from('pt_clients').select('id, name, email, goals, coaching_focus, current_weight_kg, activity_tag').neq('status', 'archived');
  if (clientId) query = query.eq('id', clientId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<Record<string, unknown> & { id: string }>;
}

async function buildSnapshot(
  admin: ReturnType<typeof createClient>,
  client: Record<string, unknown> & { id: string },
  weekStart: string,
  weekEnd: string,
) {
  const startIso = `${weekStart}T00:00:00.000Z`;
  const endIso = `${addDays(weekEnd, 1)}T00:00:00.000Z`;
  const [
    workoutsRes,
    setsRes,
    nutritionLogsRes,
    checkinsRes,
    messagesRes,
    metricsRes,
    assignmentRes,
    nutritionDocRes,
    phaseNutritionRes,
  ] = await Promise.all([
    admin.from('pt_workout_logs').select('*').eq('client_id', client.id).gte('completed_at', startIso).lt('completed_at', endIso).order('completed_at', { ascending: true }),
    admin.from('pt_set_logs').select('*').eq('client_id', client.id).gte('created_at', startIso).lt('created_at', endIso).order('created_at', { ascending: true }),
    admin.from('pt_nutrition_logs').select('*').eq('client_id', client.id).gte('logged_at', startIso).lt('logged_at', endIso).order('logged_at', { ascending: true }),
    admin.from('pt_weekly_checkins').select('*').eq('client_id', client.id).gte('week_start', weekStart).lte('week_start', weekEnd).order('week_start', { ascending: false }),
    admin.from('pt_messages').select('sender, content, created_at, context').eq('client_id', client.id).gte('created_at', startIso).lt('created_at', endIso).order('created_at', { ascending: false }).limit(30),
    admin.from('pt_client_metrics').select('*').eq('client_id', client.id).order('measured_at', { ascending: false }).limit(8),
    admin.from('pt_program_assignments').select('id, name, goal, duration_weeks, programme, nutrition_sync').eq('client_id', client.id).eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('pt_client_nutrition_doc').select('daily_targets, adherence_metrics, phase_nutrition_strategy, pyramid_finalizer, recurring_gaps, recent_wins').eq('client_id', client.id).maybeSingle(),
    admin.from('pt_phase_nutrition').select('*').eq('client_id', client.id).eq('review_status', 'approved').order('phase_index', { ascending: true }),
  ]);

  return {
    client,
    week_start: weekStart,
    week_end: weekEnd,
    workouts: workoutsRes.data ?? [],
    sets: setsRes.data ?? [],
    nutrition_logs: nutritionLogsRes.data ?? [],
    checkins: checkinsRes.data ?? [],
    client_messages: (messagesRes.data ?? []).filter((m: Record<string, unknown>) => m.sender === 'client'),
    metrics: metricsRes.data ?? [],
    active_programme: assignmentRes.data ?? null,
    nutrition_doc: nutritionDocRes.data ?? null,
    phase_nutrition: phaseNutritionRes.data ?? [],
  };
}

async function generateReport(anthropic: Anthropic, snapshot: Record<string, unknown>): Promise<WeeklyReport> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1200,
    system: `You are Pedro Avila's weekly client brain review bot.
Return only valid JSON. No markdown.
Use only the supplied data. Be concise and operational.
Schema:
{
  "coach_summary": "what Pedro should know and do",
  "client_summary": "calm client-facing summary",
  "nutrition_summary": "nutrition log/target adherence and next focus",
  "training_summary": "training completion/performance signal",
  "flags": ["important issue or follow-up"]
}`,
    messages: [{ role: 'user', content: JSON.stringify(snapshot) }],
  });
  const raw = response.content[0]?.type === 'text' ? response.content[0].text : '';
  const parsed = parseJson(raw) as Partial<WeeklyReport> | null;
  return {
    coach_summary: text(parsed?.coach_summary, 'No clear weekly summary was generated. Review the source snapshot.'),
    client_summary: text(parsed?.client_summary, 'This week has been logged. Pedro will review the details and adjust where needed.'),
    nutrition_summary: text(parsed?.nutrition_summary, 'No strong nutrition pattern was detected this week.'),
    training_summary: text(parsed?.training_summary, 'No strong training pattern was detected this week.'),
    flags: Array.isArray(parsed?.flags) ? parsed!.flags!.filter((flag): flag is string => typeof flag === 'string').slice(0, 8) : [],
  };
}

async function callInternalFunction(supabaseUrl: string, serviceKey: string, name: string, body: Record<string, unknown>) {
  const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error(`${name} failed:`, await res.text());
}

function normalizeWeekStart(value?: string) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return dateValue(d);
}

function addDays(value: string, days: number) {
  const d = new Date(`${value}T00:00:00`);
  d.setDate(d.getDate() + days);
  return dateValue(d);
}

function dateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseJson(textValue: string): unknown | null {
  const match = textValue.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function text(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 1600) : fallback;
}
