import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TIMEZONE = 'Australia/Sydney';
const SESSION_DURATION_MINUTES = 45;

interface RequestBody {
  client_id: string;
  session_id?: string | null;
  user_message: string;
  image_base64?: string | null;
  image_mime_type?: string | null;
  action?: 'start' | 'message' | 'book_slot' | 'skip_booking';
  selected_slot?: SlotSuggestion | null;
}

interface SlotSuggestion {
  date: string;
  start_at: string;
  end_at: string;
  label: string;
}

interface AvailabilityRow {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  session_duration_minutes?: number;
  buffer_minutes?: number;
  location: string | null;
  label: string | null;
}

interface CheckinMessage {
  role: 'user' | 'assistant';
  content: string;
  ui_hint?: string;
  created_at: string;
}

interface CheckinSession {
  id: string;
  client_id: string;
  week_start: string;
  status: string;
  messages: CheckinMessage[];
  activity_selections: Array<{activity: string; suggested_date: string; suggested_time: string; confirmed: boolean}> | null;
  pt_session_suggestions: SlotSuggestion[] | null;
  ai_weekly_focus: {exercise: string; nutrition: string; sleep: string} | null;
  injury_tips: string | null;
  stress_tips: string | null;
  nutrition_tips: string | null;
  completed_at: string | null;
}

interface AIResponse {
  message: string;
  ui_hint: 'none' | 'calendar_upload' | 'pt_slot_select' | 'activity_select' | 'checkin_complete';
  payload?: Record<string, unknown>;
  extract?: {
    phase?: string;
    activities_selected?: string[];
    activity_schedule?: Array<{activity: string; day: string; day_offset: number}>;
    soreness_level?: number | null;
    injuries?: string | null;
    protein_ok?: boolean | null;
    nutrition_notes?: string | null;
    stress_level?: number | null;
    stress_notes?: string | null;
    weekly_focus?: {exercise: string; nutrition: string; sleep: string} | null;
    injury_tips?: string | null;
    stress_tips?: string | null;
    nutrition_tips?: string | null;
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization.' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')!;

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: 'Unauthorized.' }, 401);

    const body = (await req.json()) as RequestBody;
    if (!body.client_id) return json({ error: 'Missing client_id.' }, 400);

    const { data: clientRow } = await adminClient
      .from('pt_clients')
      .select('id, name, email, goals, coaching_focus, lifestyle_context, event_goal, regular_training_slot, sessions_remaining')
      .eq('id', body.client_id)
      .eq('user_id', authData.user.id)
      .single();

    if (!clientRow) return json({ error: 'Client not found.' }, 404);
    const client = clientRow as {
      id: string; name: string; email: string; goals: string | null;
      coaching_focus: string | null; lifestyle_context: string | null;
      event_goal: string | null; regular_training_slot: string | null;
      sessions_remaining: number;
    };

    const nextMonday = getNextMonday();
    const weekStart = toDateString(nextMonday);

    const [goalsRes, lastCheckinsRes, sessionRes, availabilityRes, blocksRes] = await Promise.all([
      adminClient.from('pt_client_goals').select('title, goal_type, target_value, current_value, unit, target_date').eq('client_id', client.id).eq('status', 'active').limit(6),
      adminClient.from('pt_weekly_checkins').select('*').eq('client_id', client.id).order('week_start', { ascending: false }).limit(4),
      body.session_id
        ? adminClient.from('pt_checkin_sessions').select('*').eq('id', body.session_id).single()
        : adminClient.from('pt_checkin_sessions').select('*').eq('client_id', client.id).eq('week_start', weekStart).maybeSingle(),
      adminClient.from('pt_booking_availability').select('*').eq('is_active', true),
      adminClient
        .from('pt_booking_blocks')
        .select('start_at, end_at')
        .eq('status', 'active')
        .gte('end_at', nextMonday.toISOString())
        .lt('start_at', new Date(nextMonday.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()),
    ]);

    const goals = (goalsRes.data ?? []) as Array<{title: string; goal_type: string; target_value: number | null; current_value: number | null; unit: string | null; target_date: string | null}>;
    const lastCheckins = (lastCheckinsRes.data ?? []) as Array<Record<string, unknown>>;
    const availability = (availabilityRes.data ?? []) as AvailabilityRow[];
    const existingBlocks = (blocksRes.data ?? []) as Array<{start_at: string; end_at: string}>;

    let session = (sessionRes.data ?? null) as CheckinSession | null;

    if (!session) {
      const { data: newSession, error: sessionError } = await adminClient
        .from('pt_checkin_sessions')
        .insert({ client_id: client.id, week_start: weekStart, messages: [], status: 'in_progress' })
        .select('*')
        .single();
      if (sessionError || !newSession) return json({ error: 'Could not create check-in session.' }, 500);
      session = newSession as CheckinSession;
    }

    const ptSlots = generateAvailableSlots(nextMonday, availability, existingBlocks);

    const systemPrompt = buildSystemPrompt(client, goals, lastCheckins, ptSlots, weekStart);

    const conversationMessages: Anthropic.MessageParam[] = session.messages.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }));

    const userContent: Anthropic.ContentBlock[] = [];

    if (body.image_base64 && body.image_mime_type) {
      userContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: body.image_mime_type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: body.image_base64,
        },
      } as Anthropic.ImageBlockParam);
    }

    if (body.user_message.trim()) {
      userContent.push({ type: 'text', text: body.user_message.trim() } as Anthropic.TextBlockParam);
    }

    if (userContent.length === 0) {
      userContent.push({ type: 'text', text: 'Start the check-in.' } as Anthropic.TextBlockParam);
    }

    conversationMessages.push({ role: 'user', content: userContent });

    const anthropic = new Anthropic({ apiKey: anthropicKey });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: conversationMessages,
    });

    const rawContent = response.content.find((block) => block.type === 'text')?.text ?? '';

    let aiResponse: AIResponse;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      aiResponse = JSON.parse(jsonMatch ? jsonMatch[0] : rawContent) as AIResponse;
    } catch {
      aiResponse = { message: rawContent, ui_hint: 'none' };
    }

    const now = new Date().toISOString();
    const userMsg: CheckinMessage = {
      role: 'user',
      content: body.user_message.trim() || (body.image_base64 ? '[Calendar screenshot uploaded]' : 'Start'),
      created_at: now,
    };
    const assistantMsg: CheckinMessage = {
      role: 'assistant',
      content: aiResponse.message,
      ui_hint: aiResponse.ui_hint !== 'none' ? aiResponse.ui_hint : undefined,
      created_at: now,
    };

    const updatedMessages = [...session.messages, userMsg, assistantMsg];

    const sessionUpdate: Record<string, unknown> = {
      messages: updatedMessages,
      updated_at: now,
    };

    const responsePayload: Record<string, unknown> = {};

    if (aiResponse.ui_hint === 'pt_slot_select') {
      responsePayload.slots = ptSlots.slice(0, 6);
      sessionUpdate.pt_session_suggestions = ptSlots.slice(0, 6);
    }

    if (aiResponse.ui_hint === 'activity_select') {
      responsePayload.activities = ['Golf', 'Run', 'Pilates', 'Walk', 'Classes'];
    }

    if (aiResponse.ui_hint === 'checkin_complete' && aiResponse.extract) {
      const focus = aiResponse.extract.weekly_focus ?? null;
      const activitySchedule = aiResponse.extract.activity_schedule ?? null;

      sessionUpdate.ai_weekly_focus = focus;
      sessionUpdate.injury_tips = aiResponse.extract.injury_tips ?? null;
      sessionUpdate.stress_tips = aiResponse.extract.stress_tips ?? null;
      sessionUpdate.nutrition_tips = aiResponse.extract.nutrition_tips ?? null;
      sessionUpdate.status = 'completed';
      sessionUpdate.completed_at = now;

      if (activitySchedule && activitySchedule.length > 0) {
        const activitySelections = activitySchedule.map((item) => {
          const dayDate = new Date(nextMonday.getTime() + item.day_offset * 24 * 60 * 60 * 1000);
          return {
            activity: item.activity,
            suggested_date: toDateString(dayDate),
            suggested_time: item.day,
            confirmed: true,
          };
        });
        sessionUpdate.activity_selections = activitySelections;
        responsePayload.activity_selections = activitySelections;

        await createActivityPlanItems(adminClient, client.id, weekStart, activitySelections);
      }

      if (focus) responsePayload.focus = focus;

      await upsertWeeklyCheckin(adminClient, client.id, weekStart, session.id, aiResponse.extract);
      await createCheckinCoachingTask(adminClient, client.id, weekStart, client.name, focus);
    }

    await adminClient
      .from('pt_checkin_sessions')
      .update(sessionUpdate)
      .eq('id', session.id);

    return json({
      session_id: session.id,
      ai_message: aiResponse.message,
      ui_hint: aiResponse.ui_hint,
      payload: Object.keys(responsePayload).length > 0 ? responsePayload : undefined,
    });
  } catch (error) {
    console.error('client-ai-checkin error:', error);
    return json({ error: error instanceof Error ? error.message : 'Check-in failed.' }, 500);
  }
});

function buildSystemPrompt(
  client: {name: string; coaching_focus: string | null; lifestyle_context: string | null; event_goal: string | null; regular_training_slot: string | null; sessions_remaining: number},
  goals: Array<{title: string; goal_type: string; target_value: number | null; current_value: number | null; unit: string | null; target_date: string | null}>,
  lastCheckins: Array<Record<string, unknown>>,
  ptSlots: SlotSuggestion[],
  weekStart: string,
): string {
  const goalsText = goals.length > 0
    ? goals.map((g) => `- ${g.title}${g.target_value ? ` (target: ${g.target_value}${g.unit ?? ''})` : ''}`).join('\n')
    : 'No active goals set yet.';

  const lastCheckinText = lastCheckins.length > 0
    ? lastCheckins.slice(0, 2).map((c) => {
        const parts = [];
        if (c.energy) parts.push(`energy ${c.energy}/5`);
        if (c.soreness) parts.push(`soreness ${c.soreness}/5`);
        if (c.stress) parts.push(`stress ${c.stress}/5`);
        if (c.client_focus) parts.push(`focus: ${c.client_focus}`);
        return `Week of ${c.week_start}: ${parts.join(', ') || 'submitted'}`;
      }).join('\n')
    : 'No previous check-ins.';

  const slotsText = ptSlots.length > 0
    ? ptSlots.slice(0, 6).map((s, i) => `[${i}] ${s.label}`).join('\n')
    : 'No available slots found for next week.';

  return `You are the personal AI coaching assistant for ${client.name}, a client of Pedro Avila (PT/strength coach based in Sydney, Australia).

Your job is to run a warm, conversational Friday check-in to set ${client.name} up for the week ahead (week starting ${weekStart}).

CLIENT CONTEXT:
- Coaching focus: ${client.coaching_focus ?? 'General fitness and strength'}
- Lifestyle: ${client.lifestyle_context ?? 'Not provided'}
- Event goal: ${client.event_goal ?? 'None'}
- Regular training slot: ${client.regular_training_slot ?? 'Not set'}
- Sessions remaining in pack: ${client.sessions_remaining}

ACTIVE GOALS:
${goalsText}

RECENT CHECK-INS:
${lastCheckinText}

PEDRO'S AVAILABLE PT SESSION SLOTS NEXT WEEK (Sydney time):
${slotsText}

CHECK-IN PHASES (complete in order):
1. GREETING - Warm greeting, mention the week, ask them to share their calendar screenshot so you can find good training times.
2. CALENDAR - After they upload the screenshot (or describe their week), analyse the calendar and suggest their PT session slot from Pedro's available times above.
3. ACTIVITIES - Ask what extra activities they want to do outside of training (golf, run, pilates, walk, classes). Use multi-select chips (the UI will show buttons).
4. ACTIVITY SCHEDULE - Based on their calendar and selected activities, suggest specific days for each activity spread through the week.
5. HEALTH - Ask about soreness or injuries. If they report anything, give brief practical tips (modify volume, add warm-up time, etc.).
6. NUTRITION - Ask how nutrition went last week and whether they hit their protein target. Give tips if they struggled.
7. STRESS - Ask about stress levels (1-10). If elevated, give 1-2 practical tips.
8. FOCUS & WRAP - Generate their personalised weekly focus for exercise, nutrition, and sleep based on everything discussed.

TONE: Warm, direct, encouraging. Like a knowledgeable mate who cares. No fluff, no filler. Short sentences. Keep it conversational.

PEDRO'S COACHING PRINCIPLES (for tips):
- Soreness tips: reduce volume 20%, extend warm-up, prioritise mobility, sleep 8h, protein first
- Injury tips: avoid the painful movement, find an alternative, notify Pedro if it persists
- Stress tips: reduce training intensity, prioritise sleep, walk daily, reduce alcohol
- Nutrition: 1.6-2g protein per kg bodyweight, meal prep on Sundays, protein at every meal

IMPORTANT - RESPONSE FORMAT:
Always respond with valid JSON only. No markdown, no text outside the JSON.

{
  "message": "Your conversational response to the client (plain text, no markdown)",
  "ui_hint": "none" | "calendar_upload" | "pt_slot_select" | "activity_select" | "checkin_complete",
  "extract": {
    "phase": "greeting" | "calendar" | "pt_slots" | "activities" | "health" | "nutrition" | "stress" | "complete",
    "activity_schedule": null | [{"activity": "Run", "day": "Tuesday morning", "day_offset": 1}],
    "soreness_level": null | number (1-5),
    "injuries": null | "description",
    "protein_ok": null | true | false,
    "nutrition_notes": null | "description",
    "stress_level": null | number (1-10),
    "stress_notes": null | "description",
    "weekly_focus": null | {"exercise": "one sentence", "nutrition": "one sentence", "sleep": "one sentence"},
    "injury_tips": null | "tips text",
    "stress_tips": null | "tips text",
    "nutrition_tips": null | "tips text"
  }
}

UI HINT RULES:
- Use "calendar_upload" on the FIRST message (greeting) to prompt the calendar upload
- Use "pt_slot_select" when you want the client to pick a PT session slot from the list above
- Use "activity_select" when you ask them to pick extra activities
- Use "checkin_complete" when the entire check-in is done (all phases complete) and weekly_focus is populated
- Use "none" for all other messages

day_offset in activity_schedule: 0=Monday, 1=Tuesday, 2=Wednesday, 3=Thursday, 4=Friday`;
}

function generateAvailableSlots(weekStart: Date, availability: AvailabilityRow[], blocks: Array<{start_at: string; end_at: string}>): SlotSuggestion[] {
  const slots: SlotSuggestion[] = [];
  const sessionMinutes = SESSION_DURATION_MINUTES;

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const dayDate = new Date(weekStart.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const formatter = new Intl.DateTimeFormat('en-AU', {
      timeZone: TIMEZONE,
      weekday: 'short',
    });
    const dayName = formatter.format(dayDate);
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dayOfWeek = dayMap[dayName] ?? -1;

    const dayWindows = availability.filter((w) => w.day_of_week === dayOfWeek);
    for (const window of dayWindows) {
      const windowStart = timeToMinutes(window.start_time);
      const windowEnd = timeToMinutes(window.end_time);
      const slotDuration = Number(window.slot_duration_minutes ?? sessionMinutes + 5);

      for (let startMin = windowStart; startMin + sessionMinutes <= windowEnd; startMin += slotDuration) {
        const slotStart = new Date(dayDate);
        const [year, month, day] = toDateString(dayDate).split('-').map(Number);
        const sydneyOffset = getSydneyOffsetMinutes(dayDate);

        slotStart.setUTCFullYear(year, month - 1, day);
        slotStart.setUTCHours(0, 0, 0, 0);
        slotStart.setUTCMinutes(startMin - sydneyOffset);

        const slotEnd = new Date(slotStart.getTime() + sessionMinutes * 60000);

        const clashes = blocks.some(
          (b) => slotStart.getTime() < new Date(b.end_at).getTime() && slotEnd.getTime() > new Date(b.start_at).getTime(),
        );

        if (!clashes && slotStart.getTime() > Date.now() + 48 * 60 * 60 * 1000) {
          const labelFormatter = new Intl.DateTimeFormat('en-AU', {
            timeZone: TIMEZONE,
            weekday: 'long',
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          });
          slots.push({
            date: toDateString(dayDate),
            start_at: slotStart.toISOString(),
            end_at: slotEnd.toISOString(),
            label: labelFormatter.format(slotStart),
          });
        }
      }
    }
  }

  return slots;
}

function getSydneyOffsetMinutes(date: Date): number {
  const utc = date.getTime();
  const formatter = new Intl.DateTimeFormat('en-AU', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  const second = Number(parts.find((p) => p.type === 'second')?.value);
  const local = Date.UTC(year, month - 1, day, hour % 24, minute, second);
  return (local - utc) / 60000;
}

async function createActivityPlanItems(
  adminClient: ReturnType<typeof createClient>,
  clientId: string,
  weekStart: string,
  activitySelections: Array<{activity: string; suggested_date: string; suggested_time: string; confirmed: boolean}>,
) {
  const activityTypeMap: Record<string, string> = {
    Golf: 'golf_mobility',
    Run: 'run',
    Pilates: 'pilates',
    Walk: 'walk',
    Classes: 'fitness_class',
  };

  const { data: planRow, error: planError } = await adminClient
    .from('pt_weekly_plans')
    .upsert({
      client_id: clientId,
      week_start: weekStart,
      status: 'published',
      coach_summary: 'AI check-in: client-selected activities auto-scheduled.',
      client_note: 'Your activities for next week, picked during your AI check-in.',
      regular_slot_status: 'unconfirmed',
      published_at: new Date().toISOString(),
    }, { onConflict: 'client_id,week_start', ignoreDuplicates: false })
    .select('id')
    .single();

  if (planError || !planRow) {
    console.error('Plan upsert failed:', planError);
    return;
  }

  const items = activitySelections
    .filter((sel) => sel.confirmed)
    .map((sel, index) => ({
      plan_id: planRow.id,
      client_id: clientId,
      item_type: activityTypeMap[sel.activity] ?? 'recovery',
      scheduled_date: sel.suggested_date,
      title: sel.activity,
      details: `Suggested time: ${sel.suggested_time}`,
      status: 'planned',
      confirmation_status: 'none',
      sort_order: index + 10,
    }));

  if (items.length > 0) {
    await adminClient.from('pt_weekly_plan_items').insert(items);
  }
}

async function upsertWeeklyCheckin(
  adminClient: ReturnType<typeof createClient>,
  clientId: string,
  weekStart: string,
  sessionId: string,
  extract: AIResponse['extract'],
) {
  await adminClient.from('pt_weekly_checkins').upsert({
    client_id: clientId,
    week_start: weekStart,
    checkin_session_id: sessionId,
    checkin_mode: 'ai',
    status: 'submitted',
    soreness: extract?.soreness_level ?? null,
    injuries: extract?.injuries ?? null,
    stress: extract?.stress_level ? Math.round(extract.stress_level / 2) : null,
    nutrition_focus: extract?.nutrition_notes ?? null,
    client_focus: extract?.weekly_focus?.exercise ?? null,
  }, { onConflict: 'client_id,week_start' });
}

async function createCheckinCoachingTask(
  adminClient: ReturnType<typeof createClient>,
  clientId: string,
  weekStart: string,
  clientName: string,
  focus: {exercise: string; nutrition: string; sleep: string} | null | undefined,
) {
  const details = focus
    ? `Exercise: ${focus.exercise}\nNutrition: ${focus.nutrition}\nSleep: ${focus.sleep}`
    : 'AI check-in completed.';

  await adminClient.from('pt_coaching_tasks').insert({
    client_id: clientId,
    source_type: 'ai_checkin',
    source_id: null,
    title: `Review AI check-in - ${clientName} (week of ${weekStart})`,
    details,
    priority: 'normal',
    status: 'open',
    due_at: new Date().toISOString(),
  });
}

function getNextMonday(): Date {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const parts = formatter.formatToParts(now);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const currentDay = dayMap[weekday] ?? 1;
  const daysUntilNextMonday = ((8 - currentDay) % 7) || 7;
  return new Date(Date.UTC(year, month - 1, day + daysUntilNextMonday));
}

function toDateString(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function timeToMinutes(value: string): number {
  const [hour, minute] = value.slice(0, 5).split(':').map(Number);
  return hour * 60 + minute;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
