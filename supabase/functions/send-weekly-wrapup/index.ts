import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PEDRO_EMAILS = ['pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com'];
const DEFAULT_CRON_TOKEN = 'cerebro-cron-2026';
const WORKFLOW_KEY = 'weekly_wrap_up';
const NOTIFICATION_TYPE = 'weekly_wrap_up';
// Flip to true to skip clients with no activity instead of sending a gentle version.
const SKIP_INACTIVE = false;

interface RequestBody {
  mode?: 'scheduled' | 'preview';
  client_id?: string;
  week_start?: string;
  to?: string;
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
    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const mode = body.mode ?? 'scheduled';

    const authz = await authorize(req, supabaseUrl, anonKey, admin, authHeader, serviceKey, mode);
    if (!authz.ok) return json({ error: authz.error }, authz.status);

    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const weekStart = normalizeWeekStart(body.week_start);
    const weekEnd = addDays(weekStart, 6);

    // Load the wrap-up template. Scheduled sends require a published (live) template.
    const { data: templateRow } = await admin
      .from('pt_email_templates')
      .select('subject, html, status')
      .eq('workflow_key', WORKFLOW_KEY)
      .maybeSingle();

    if (mode === 'preview') {
      if (!body.client_id) return json({ error: 'client_id is required for preview.' }, 400);
      if (!templateRow?.html) return json({ error: 'Design and save the weekly wrap-up email first.' }, 400);
      const to = (body.to || authz.email || PEDRO_EMAILS[3]).trim();
      const clients = await loadClients(admin, body.client_id);
      if (clients.length === 0) return json({ error: 'Client not found.' }, 404);
      const client = clients[0];
      const metrics = await buildMetrics(admin, client, weekStart, weekEnd);
      const recap = await generateRecap(anthropic, client, metrics);
      const values = tagValues(metrics, recap, client);
      const subject = `[PREVIEW] ${resolveTags(String(templateRow.subject ?? ''), values)}`;
      const html = resolveTags(String(templateRow.html), values);
      const sent = await sendHtmlEmail(to, subject, html);
      return json({ ok: sent, mode: 'preview', client_id: client.id, week_start: weekStart, to, sent });
    }

    // Scheduled send.
    if (templateRow?.status !== 'live' || !templateRow?.html) {
      return json({ ok: false, error: 'No live weekly wrap-up template. Publish it in the email editor.', week_start: weekStart }, 200);
    }

    const clients = await loadClients(admin);
    let sentCount = 0;
    let skipped = 0;
    const results: Array<Record<string, unknown>> = [];

    for (const client of clients) {
      try {
        const metrics = await buildMetrics(admin, client, weekStart, weekEnd);

        // Dedup: already sent this week?
        const { count } = await admin
          .from('pt_notification_log')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', client.id)
          .eq('notification_type', NOTIFICATION_TYPE)
          .eq('metadata->>week_start', weekStart);
        if ((count ?? 0) > 0) { skipped++; results.push({ client_id: client.id, skipped: 'already_sent' }); continue; }

        if (SKIP_INACTIVE && !metrics.had_activity) { skipped++; results.push({ client_id: client.id, skipped: 'no_activity' }); continue; }

        const recap = await generateRecap(anthropic, client, metrics);

        await admin.from('pt_client_weekly_wrapup').upsert({
          client_id: client.id,
          week_start: weekStart,
          week_end: weekEnd,
          metrics,
          recap,
          had_activity: metrics.had_activity,
          generated_at: new Date().toISOString(),
        }, { onConflict: 'client_id,week_start' });

        const email = String(client.email ?? '').trim();
        if (!email) { skipped++; results.push({ client_id: client.id, skipped: 'no_email' }); continue; }

        const values = tagValues(metrics, recap, client);
        const subject = resolveTags(String(templateRow.subject ?? 'Your week, wrapped'), values);
        const html = resolveTags(String(templateRow.html), values);
        const ok = await sendHtmlEmail(email, subject, html);
        if (!ok) { skipped++; results.push({ client_id: client.id, skipped: 'send_failed' }); continue; }

        await admin.from('pt_notification_log').insert({
          client_id: client.id,
          notification_type: NOTIFICATION_TYPE,
          recipient_email: email,
          subject,
          metadata: { week_start: weekStart },
        });
        sentCount++;
        results.push({ client_id: client.id, sent: true });
      } catch (err) {
        results.push({ client_id: client.id, error: err instanceof Error ? err.message : 'failed' });
      }
    }

    return json({ ok: true, week_start: weekStart, week_end: weekEnd, sent: sentCount, skipped, results });
  } catch (error) {
    console.error('send-weekly-wrapup error:', error);
    return json({ error: error instanceof Error ? error.message : 'Weekly wrap-up failed.' }, 500);
  }
});

async function authorize(
  req: Request,
  supabaseUrl: string,
  anonKey: string,
  admin: ReturnType<typeof createClient>,
  authHeader: string,
  serviceKey: string,
  mode: string,
): Promise<{ ok: true; email: string } | { ok: false; error: string; status: number }> {
  const token = authHeader.replace('Bearer ', '');
  const cronToken = Deno.env.get('CEREBRO_INTERNAL_SECRET') ?? DEFAULT_CRON_TOKEN;
  if (token === serviceKey || token === cronToken) return { ok: true, email: '' };

  // User-auth path (preview from the dashboard).
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return { ok: false, error: 'Unauthorized.', status: 401 };
  const email = data.user.email?.toLowerCase() ?? '';
  const { data: profile } = await admin.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
  if (PEDRO_EMAILS.includes(email) || profile?.role === 'admin') return { ok: true, email };
  return { ok: false, error: mode === 'preview' ? 'Only Pedro can preview wrap-ups.' : 'Only Pedro can run wrap-ups.', status: 403 };
}

async function loadClients(admin: ReturnType<typeof createClient>, clientId?: string) {
  let query = admin
    .from('pt_clients')
    .select('id, name, email, status, receive_weekly_wrap_up_email')
    .neq('status', 'archived');
  if (clientId) query = query.eq('id', clientId);
  else query = query.eq('receive_weekly_wrap_up_email', true);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<Record<string, unknown> & { id: string }>;
}

interface WrapMetrics {
  client_first_name: string;
  range_label: string;
  total_volume_kg: string;
  workouts_completed: string;
  workouts_planned: string;
  workouts_ratio: string;
  top_exercise: string;
  biggest_lift: string;
  new_pbs_count: string;
  new_pbs_list: string;
  protein_days_hit: string;
  calorie_days_hit: string;
  protein_adherence_pct: string;
  consistency_streak: string;
  energy_avg: string;
  energy_trend: string;
  had_activity: boolean;
}

async function buildMetrics(
  admin: ReturnType<typeof createClient>,
  client: Record<string, unknown> & { id: string },
  weekStart: string,
  weekEnd: string,
): Promise<WrapMetrics> {
  const startIso = `${weekStart}T00:00:00.000Z`;
  const endIso = `${addDays(weekEnd, 1)}T00:00:00.000Z`;

  const [workoutsRes, setsRes, nutritionRes, checkinRes, oneRmRes, nutritionDocRes, assignmentRes] = await Promise.all([
    admin.from('pt_workout_logs').select('id, created_at').eq('client_id', client.id).gte('created_at', startIso).lt('created_at', endIso),
    admin.from('pt_set_logs').select('exercise_name, reps, weight, created_at').eq('client_id', client.id).gte('created_at', startIso).lt('created_at', endIso),
    admin.from('pt_nutrition_logs').select('logged_at, protein_g, calories').eq('client_id', client.id).gte('logged_at', startIso).lt('logged_at', endIso),
    admin.from('pt_weekly_checkins').select('energy').eq('client_id', client.id).eq('week_start', weekStart).maybeSingle(),
    admin.from('pt_client_1rm_results').select('exercise_name, estimated_1rm_kg, created_at').eq('client_id', client.id).order('created_at', { ascending: false }),
    admin.from('pt_client_nutrition_doc').select('daily_targets').eq('client_id', client.id).maybeSingle(),
    admin.from('pt_program_assignments').select('current_phase_index, programme').eq('client_id', client.id).eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const workouts = (workoutsRes.data ?? []) as Array<{ created_at: string }>;
  const sets = (setsRes.data ?? []) as Array<{ exercise_name: string | null; reps: number | null; weight: number | null; created_at: string }>;
  const nutrition = (nutritionRes.data ?? []) as Array<{ logged_at: string; protein_g: number | null; calories: number | null }>;
  const energy = (checkinRes.data as { energy: number | null } | null)?.energy ?? null;
  const baselines = (oneRmRes.data ?? []) as Array<{ exercise_name: string; estimated_1rm_kg: number | null }>;
  const targets = (nutritionDocRes.data as { daily_targets: Record<string, number> | null } | null)?.daily_targets ?? null;
  const assignment = assignmentRes.data as { current_phase_index: number | null; programme: { phases?: Array<{ days?: unknown[] }> } | null } | null;

  // Volume / top exercise / biggest lift
  let totalVolume = 0;
  const exerciseCounts = new Map<string, number>();
  let biggest: { name: string; weight: number } | null = null;
  const weekBestByExercise = new Map<string, number>();
  for (const s of sets) {
    const reps = Number(s.reps) || 0;
    const weight = Number(s.weight) || 0;
    const name = (s.exercise_name ?? '').trim();
    if (reps > 0 && weight > 0) totalVolume += reps * weight;
    if (name) exerciseCounts.set(name, (exerciseCounts.get(name) ?? 0) + 1);
    if (weight > 0 && (!biggest || weight > biggest.weight)) biggest = { name: name || 'Lift', weight };
    if (name && weight > 0 && reps > 0 && reps < 37) {
      const est = weight * (36 / (37 - reps));
      if (est > (weekBestByExercise.get(name) ?? 0)) weekBestByExercise.set(name, est);
    }
  }
  const topExercise = [...exerciseCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

  // PBs vs latest baseline per exercise
  const baselineByExercise = new Map<string, number>();
  for (const b of baselines) {
    const name = (b.exercise_name ?? '').trim();
    if (name && !baselineByExercise.has(name) && Number(b.estimated_1rm_kg) > 0) {
      baselineByExercise.set(name, Number(b.estimated_1rm_kg));
    }
  }
  const newPbs: Array<{ name: string; kg: number }> = [];
  for (const [name, est] of weekBestByExercise.entries()) {
    const base = baselineByExercise.get(name);
    if (base && est > base + 0.5) newPbs.push({ name, kg: Math.round(est * 2) / 2 });
  }

  // Nutrition adherence by day
  const byDay = new Map<string, { protein: number; calories: number }>();
  for (const n of nutrition) {
    const day = n.logged_at.slice(0, 10);
    const cur = byDay.get(day) ?? { protein: 0, calories: 0 };
    cur.protein += Number(n.protein_g) || 0;
    cur.calories += Number(n.calories) || 0;
    byDay.set(day, cur);
  }
  const proteinTarget = Number(targets?.protein_g) || 0;
  const calorieTarget = Number(targets?.calories) || 0;
  let proteinDaysHit = 0;
  let calorieDaysHit = 0;
  let proteinSum = 0;
  for (const { protein, calories } of byDay.values()) {
    if (proteinTarget > 0 && protein >= proteinTarget * 0.9) proteinDaysHit++;
    if (calorieTarget > 0 && Math.abs(calories - calorieTarget) <= calorieTarget * 0.1) calorieDaysHit++;
    proteinSum += protein;
  }
  const loggedDays = byDay.size;
  const proteinAdherence = proteinTarget > 0 && loggedDays > 0
    ? Math.min(150, Math.round((proteinSum / loggedDays / proteinTarget) * 100))
    : 0;

  // Consistency: longest run of consecutive active days within the week
  const activeDays = new Set<string>();
  for (const w of workouts) activeDays.add(w.created_at.slice(0, 10));
  for (const s of sets) activeDays.add(s.created_at.slice(0, 10));
  for (const day of byDay.keys()) activeDays.add(day);
  let streak = 0;
  let run = 0;
  for (let i = 0; i < 7; i++) {
    if (activeDays.has(addDays(weekStart, i))) { run++; streak = Math.max(streak, run); } else run = 0;
  }

  const plannedDays = assignment?.programme?.phases?.[assignment.current_phase_index ?? 0]?.days?.length ?? 0;
  const hadActivity = workouts.length > 0 || sets.length > 0 || nutrition.length > 0;

  return {
    client_first_name: String(client.name ?? '').trim().split(/\s+/)[0] || 'there',
    range_label: rangeLabel(weekStart, weekEnd),
    total_volume_kg: Math.round(totalVolume).toLocaleString('en-AU'),
    workouts_completed: String(workouts.length),
    workouts_planned: plannedDays > 0 ? String(plannedDays) : '',
    workouts_ratio: plannedDays > 0 ? `${workouts.length} of ${plannedDays}` : String(workouts.length),
    top_exercise: topExercise || '—',
    biggest_lift: biggest ? `${biggest.name} ${biggest.weight}kg` : '—',
    new_pbs_count: String(newPbs.length),
    new_pbs_list: newPbs.length > 0 ? newPbs.map((p) => `${p.name} ${p.kg}kg`).join(', ') : 'No new PBs this week',
    protein_days_hit: String(proteinDaysHit),
    calorie_days_hit: String(calorieDaysHit),
    protein_adherence_pct: proteinTarget > 0 ? `${proteinAdherence}%` : '—',
    consistency_streak: String(streak),
    energy_avg: energy != null ? String(energy) : '—',
    energy_trend: energy == null ? '' : energy >= 4 ? 'strong' : energy === 3 ? 'steady' : 'low',
    had_activity: hadActivity,
  };
}

interface WrapRecap {
  recap_headline: string;
  recap_paragraph: string;
  coach_nudge: string;
}

async function generateRecap(anthropic: Anthropic, client: Record<string, unknown>, metrics: WrapMetrics): Promise<WrapRecap> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: `You write a short Spotify-Wrapped-style weekly fitness recap for a personal-training client, in Pedro Avila's warm, direct coaching voice.
Return only valid JSON, no markdown. Use ONLY the supplied numbers — never invent stats.
If the week was quiet (had_activity false or zeros), be encouraging and re-engaging, not guilt-tripping.
Schema:
{
  "recap_headline": "punchy one-liner, max ~6 words",
  "recap_paragraph": "2-4 warm sentences about their week",
  "coach_nudge": "one forward-looking action for next week"
}`,
      messages: [{ role: 'user', content: JSON.stringify({ first_name: metrics.client_first_name, metrics }) }],
    });
    const raw = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const parsed = parseJson(raw) as Partial<WrapRecap> | null;
    return {
      recap_headline: text(parsed?.recap_headline, 'Your week, wrapped'),
      recap_paragraph: text(parsed?.recap_paragraph, 'Another week in the books. Keep showing up — consistency is what moves the needle.'),
      coach_nudge: text(parsed?.coach_nudge, 'Lock in your sessions for next week.'),
    };
  } catch (err) {
    console.error('recap generation failed:', err);
    return {
      recap_headline: 'Your week, wrapped',
      recap_paragraph: 'Another week in the books. Keep showing up — consistency is what moves the needle.',
      coach_nudge: 'Lock in your sessions for next week.',
    };
  }
}

function tagValues(metrics: WrapMetrics, recap: WrapRecap, client: Record<string, unknown>): Record<string, string> {
  const { had_activity: _omit, ...metricStrings } = metrics;
  void _omit;
  void client;
  return { ...metricStrings, ...recap } as Record<string, string>;
}

function resolveTags(input: string, values: Record<string, string>): string {
  return input.replace(/\{\{\s*week\.([a-zA-Z_]+)\s*\}\}/g, (_match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : '',
  );
}

async function sendHtmlEmail(to: string, subject: string, html: string): Promise<boolean> {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) { console.error('RESEND_API_KEY missing'); return false; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('RESEND_FROM_PEDRO_NOTIFY') ?? 'Pedro Avila Coaching <onboarding@resend.dev>',
      to,
      subject,
      html,
    }),
  });
  if (!res.ok) { console.error('Resend send failed:', await res.text()); return false; }
  return true;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function rangeLabel(weekStart: string, weekEnd: string): string {
  const s = new Date(`${weekStart}T00:00:00`);
  const e = new Date(`${weekEnd}T00:00:00`);
  const sameMonth = s.getMonth() === e.getMonth();
  return sameMonth
    ? `${s.getDate()}–${e.getDate()} ${MONTHS[e.getMonth()]}`
    : `${s.getDate()} ${MONTHS[s.getMonth()]} – ${e.getDate()} ${MONTHS[e.getMonth()]}`;
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
  try { return JSON.parse(match[0]); } catch { return null; }
}

function text(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 800) : fallback;
}
