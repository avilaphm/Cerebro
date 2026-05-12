import OpenAI from 'npm:openai@4.104.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PEDRO_EMAILS = ['pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au'];

type ReviewType = 'weekly' | 'monthly';

interface ReviewRequest {
  client_id?: string;
  review_type?: ReviewType;
  period_start?: string;
}

interface ReviewResponse {
  review_type: ReviewType;
  period_start: string;
  period_end: string;
  total_items: number;
  completed_items: number;
  skipped_items: number;
  adherence_pct: number | null;
  metrics_summary: string;
  performance_summary: string;
  client_feedback: string;
  what_got_done: string;
  what_was_missed: string;
  suggested_changes: string;
  pedro_summary: string;
  client_summary: string;
  body_snapshot: Record<string, unknown>;
  performance_snapshot: Record<string, unknown>;
}

const SYSTEM = `You are Pedro Avila's coaching review assistant.

Return only valid JSON. No markdown. No commentary.

You are generating either:
- a weekly review for Pedro to use internally, or
- a monthly summary Pedro could share with the client.

Schema:
{
  "metrics_summary": "Body composition and metric movement",
  "performance_summary": "Training and adherence snapshot",
  "client_feedback": "Concise summary of what the client reported",
  "what_got_done": "What was completed",
  "what_was_missed": "What was missed or moved",
  "suggested_changes": "What Pedro should change next",
  "pedro_summary": "Coach-facing decision summary",
  "client_summary": "Client-facing summary in calm plain language"
}

Rules:
- Use only the supplied data.
- Be specific, but do not invent numbers or claims.
- If evidence is weak or missing, say that plainly.
- Avoid medical diagnosis or treatment language.
- Weekly reviews should feel tactical and operational.
- Monthly reviews should feel reflective, calm, and motivating without hype.
- Pedro is the coach. Write as an assistant supporting Pedro's judgement.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json('ok', 200);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization.' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY');

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(url, serviceKey);

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: 'Unauthorized.' }, 401);

    const requesterEmail = authData.user.email?.toLowerCase() ?? '';
    const { data: requesterProfile } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', authData.user.id)
      .maybeSingle();

    if (requesterProfile?.role !== 'admin' && !PEDRO_EMAILS.includes(requesterEmail)) {
      return json({ error: 'Only Pedro can generate coaching reviews.' }, 403);
    }

    const body = (await req.json()) as ReviewRequest;
    const clientId = body.client_id;
    const reviewType = body.review_type;
    const periodStart = normalisePeriodStart(body.period_start, reviewType);

    if (!clientId) return json({ error: 'Missing client_id.' }, 400);
    if (reviewType !== 'weekly' && reviewType !== 'monthly') return json({ error: 'Invalid review_type.' }, 400);

    const periodEnd = reviewType === 'weekly' ? addDays(periodStart, 6) : monthEndInputValue(periodStart);

    const [
      clientRes,
      plansRes,
      itemsRes,
      metricsRes,
      goalsRes,
      checkinsRes,
      notesRes,
      messagesRes,
      workoutsRes,
    ] = await Promise.all([
      adminClient
        .from('pt_clients')
        .select('id, name, goals, notes, lifestyle_context, regular_training_slot, coaching_focus, event_goal')
        .eq('id', clientId)
        .single(),
      adminClient
        .from('pt_weekly_plans')
        .select('*')
        .eq('client_id', clientId)
        .gte('week_start', reviewType === 'weekly' ? periodStart : monthStartInputValue(periodStart))
        .lte('week_start', periodEnd)
        .order('week_start', { ascending: false }),
      adminClient
        .from('pt_weekly_plan_items')
        .select('*')
        .eq('client_id', clientId)
        .order('scheduled_date', { ascending: true })
        .order('sort_order', { ascending: true }),
      adminClient
        .from('pt_client_metrics')
        .select('*')
        .eq('client_id', clientId)
        .order('measured_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(12),
      adminClient
        .from('pt_client_goals')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false }),
      adminClient
        .from('pt_weekly_checkins')
        .select('*')
        .eq('client_id', clientId)
        .gte('week_start', reviewType === 'weekly' ? periodStart : monthStartInputValue(periodStart))
        .lte('week_start', periodEnd)
        .order('week_start', { ascending: false }),
      adminClient
        .from('pt_client_notes')
        .select('content, created_at, context')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(12),
      adminClient
        .from('pt_messages')
        .select('content, sender, created_at, context')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(20),
      adminClient
        .from('pt_workout_logs')
        .select('id, workout_title, phase_index, day_index, week_number, block_index, completed_at, created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    if (clientRes.error || !clientRes.data) return json({ error: 'Client not found.' }, 404);

    const plans = (plansRes.data ?? []) as Array<Record<string, unknown>>;
    const planIds = new Set(plans.map((plan) => String(plan.id)));
    const planItems = ((itemsRes.data ?? []) as Array<Record<string, unknown>>).filter((item) => {
      const scheduledDate = typeof item.scheduled_date === 'string' ? item.scheduled_date : null;
      if (scheduledDate && scheduledDate >= periodStart && scheduledDate <= periodEnd) return true;
      return planIds.has(String(item.plan_id));
    });
    const metrics = (metricsRes.data ?? []) as Array<Record<string, unknown>>;
    const checkins = (checkinsRes.data ?? []) as Array<Record<string, unknown>>;
    const notes = ((notesRes.data ?? []) as Array<Record<string, unknown>>).filter((note) => inRange(note.created_at, periodStart, periodEnd));
    const messages = ((messagesRes.data ?? []) as Array<Record<string, unknown>>).filter((message) => {
      return message.sender === 'client' && inRange(message.created_at, periodStart, periodEnd);
    });
    const workouts = ((workoutsRes.data ?? []) as Array<Record<string, unknown>>).filter((workout) => {
      const completedAt = String(workout.completed_at ?? workout.created_at ?? '');
      return completedAt ? inRange(completedAt, periodStart, periodEnd) : false;
    });

    const summary = buildSummary({
      reviewType,
      periodStart,
      periodEnd,
      client: clientRes.data as Record<string, unknown>,
      plans,
      planItems,
      metrics,
      goals: (goalsRes.data ?? []) as Array<Record<string, unknown>>,
      checkins,
      notes,
      messages,
      workouts,
    });

    if (!openaiKey) return json(summary);

    const openai = new OpenAI({ apiKey: openaiKey });
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: JSON.stringify({
              review_type: reviewType,
              period_start: periodStart,
              period_end: periodEnd,
              client: clientRes.data,
              stats: {
                total_items: summary.total_items,
                completed_items: summary.completed_items,
                skipped_items: summary.skipped_items,
                adherence_pct: summary.adherence_pct,
                body_snapshot: summary.body_snapshot,
                performance_snapshot: summary.performance_snapshot,
              },
              weekly_plans: plans,
              plan_items: planItems,
              metrics,
              goals: goalsRes.data ?? [],
              checkins,
              notes,
              client_messages: messages,
              workouts,
            }),
          },
        ],
      });

      const parsed = JSON.parse(response.choices[0]?.message.content ?? '{}') as Partial<ReviewResponse>;
      return json({
        ...summary,
        metrics_summary: text(parsed.metrics_summary, summary.metrics_summary),
        performance_summary: text(parsed.performance_summary, summary.performance_summary),
        client_feedback: text(parsed.client_feedback, summary.client_feedback),
        what_got_done: text(parsed.what_got_done, summary.what_got_done),
        what_was_missed: text(parsed.what_was_missed, summary.what_was_missed),
        suggested_changes: text(parsed.suggested_changes, summary.suggested_changes),
        pedro_summary: text(parsed.pedro_summary, summary.pedro_summary),
        client_summary: text(parsed.client_summary, summary.client_summary),
      });
    } catch {
      return json(summary);
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Review generation failed.' }, 500);
  }
});

function buildSummary(input: {
  reviewType: ReviewType;
  periodStart: string;
  periodEnd: string;
  client: Record<string, unknown>;
  plans: Array<Record<string, unknown>>;
  planItems: Array<Record<string, unknown>>;
  metrics: Array<Record<string, unknown>>;
  goals: Array<Record<string, unknown>>;
  checkins: Array<Record<string, unknown>>;
  notes: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  workouts: Array<Record<string, unknown>>;
}): ReviewResponse {
  const completedItems = input.planItems.filter((item) => item.status === 'done').length;
  const skippedItems = input.planItems.filter((item) => item.status === 'skipped').length;
  const totalItems = input.planItems.length;
  const adherencePct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : null;

  const latestMetric = input.metrics[0] ?? null;
  const previousMetric = input.metrics[1] ?? null;
  const bodySnapshot = {
    weight_kg: metricSnapshot(latestMetric, previousMetric, 'weight_kg'),
    waist_cm: metricSnapshot(latestMetric, previousMetric, 'waist_cm'),
    body_fat_pct: metricSnapshot(latestMetric, previousMetric, 'body_fat_pct'),
    muscle_mass_kg: metricSnapshot(latestMetric, previousMetric, 'muscle_mass_kg'),
  };
  const performanceSnapshot = {
    workouts_logged: input.workouts.length,
    plan_items_completed: completedItems,
    plan_items_total: totalItems,
    adherence_pct: adherencePct,
    open_notes: input.notes.length,
    client_messages: input.messages.length,
  };

  const metricBits = [
    metricLine('Weight', bodySnapshot.weight_kg),
    metricLine('Waist', bodySnapshot.waist_cm),
    metricLine('Body fat', bodySnapshot.body_fat_pct),
    metricLine('Muscle', bodySnapshot.muscle_mass_kg),
  ].filter(Boolean);

  const completedTitles = input.planItems
    .filter((item) => item.status === 'done')
    .slice(0, 6)
    .map((item) => String(item.title));
  const missedTitles = input.planItems
    .filter((item) => item.status === 'planned' || item.status === 'skipped' || item.status === 'moved')
    .slice(0, 6)
    .map((item) => String(item.title));
  const latestFeedback = [
    ...input.checkins.slice(0, 2).map((checkin) => String(checkin.client_focus ?? checkin.availability ?? '')).filter(Boolean),
    ...input.messages.slice(0, 4).map((message) => String(message.content ?? '')).filter(Boolean),
    ...input.notes.slice(0, 4).map((note) => String(note.content ?? '')).filter(Boolean),
  ].slice(0, 5);

  const metricsSummary = metricBits.length > 0
    ? metricBits.join(' / ')
    : 'No new body metrics were logged in this review window.';
  const performanceSummary = totalItems > 0
    ? `${completedItems}/${totalItems} planned items completed${adherencePct !== null ? ` (${adherencePct}% adherence)` : ''}. ${input.workouts.length} workouts logged.`
    : `${input.workouts.length} workouts logged. No weekly plan items were scheduled in this review window.`;
  const clientFeedback = latestFeedback.length > 0
    ? latestFeedback.join(' | ')
    : 'No direct client feedback was logged in this review window.';
  const whatGotDone = completedTitles.length > 0
    ? completedTitles.join(', ')
    : 'No completed weekly plan items were recorded.';
  const whatWasMissed = missedTitles.length > 0
    ? missedTitles.join(', ')
    : 'Nothing obvious was missed from the planned work.';
  const suggestedChanges = adherencePct !== null && adherencePct < 70
    ? 'Simplify next week and reduce friction around the items that were missed.'
    : 'Keep progressing the current plan and adjust only where the client feedback points to friction.';
  const pedroSummary = input.reviewType === 'weekly'
    ? `Weekly review for ${String(input.client.name ?? 'client')}: ${performanceSummary} ${clientFeedback}`
    : `Monthly summary for ${String(input.client.name ?? 'client')}: ${performanceSummary} ${metricsSummary}`;
  const clientSummary = input.reviewType === 'monthly'
    ? `This month showed ${completedItems} completed planned items${adherencePct !== null ? ` and ${adherencePct}% adherence` : ''}. ${metricBits.length > 0 ? metricsSummary : 'We will keep building cleaner metric trends next month.'}`
    : `This week had ${completedItems} completed planned items${adherencePct !== null ? ` and ${adherencePct}% adherence` : ''}.`;

  return {
    review_type: input.reviewType,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    total_items: totalItems,
    completed_items: completedItems,
    skipped_items: skippedItems,
    adherence_pct: adherencePct,
    metrics_summary: metricsSummary,
    performance_summary: performanceSummary,
    client_feedback: clientFeedback,
    what_got_done: whatGotDone,
    what_was_missed: whatWasMissed,
    suggested_changes: suggestedChanges,
    pedro_summary: pedroSummary,
    client_summary: clientSummary,
    body_snapshot: bodySnapshot,
    performance_snapshot: performanceSnapshot,
  };
}

function metricSnapshot(
  currentRow: Record<string, unknown> | null,
  previousRow: Record<string, unknown> | null,
  key: 'weight_kg' | 'waist_cm' | 'body_fat_pct' | 'muscle_mass_kg',
) {
  const current = numberValue(currentRow?.[key]);
  const previous = numberValue(previousRow?.[key]);
  return {
    current,
    previous,
    delta: current !== null && previous !== null ? Number((current - previous).toFixed(1)) : null,
  };
}

function metricLine(label: string, value: { current: number | null; delta: number | null }) {
  if (value.current === null) return null;
  if (value.delta === null || value.delta === 0) return `${label} ${value.current}`;
  return `${label} ${value.current} (${value.delta > 0 ? '+' : ''}${value.delta})`;
}

function numberValue(value: unknown) {
  return typeof value === 'number' ? value : value === null || value === undefined ? null : Number(value);
}

function normalisePeriodStart(value: string | undefined, reviewType: ReviewType | undefined) {
  if (value) return reviewType === 'monthly' ? monthStartInputValue(value) : value;
  const now = new Date();
  return reviewType === 'monthly' ? monthStartInputValue(now) : weekStartInputValue(now);
}

function weekStartInputValue(date = new Date()) {
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  return dateInputValue(next);
}

function monthStartInputValue(value: string | Date) {
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00`) : new Date(value);
  return dateInputValue(new Date(date.getFullYear(), date.getMonth(), 1));
}

function monthEndInputValue(value: string | Date) {
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00`) : new Date(value);
  return dateInputValue(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

function dateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return dateInputValue(next);
}

function inRange(value: unknown, periodStart: string, periodEnd: string) {
  if (typeof value !== 'string' || !value) return false;
  const day = value.slice(0, 10);
  return day >= periodStart && day <= periodEnd;
}

function text(value: string | undefined, fallback: string) {
  const next = value?.trim();
  if (!next) return fallback;
  return next.slice(0, 1400);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}
