import OpenAI from 'npm:openai@4.104.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PEDRO_EMAILS = ['pedro@cerebroai.au', 'avila.phm@gmail.com'];

type PlanItemType = 'pt_session' | 'solo_strength' | 'run' | 'golf_mobility' | 'recovery' | 'nutrition' | 'check_in';
type ConfirmationStatus = 'none' | 'needs_confirmation' | 'confirmed' | 'moved' | 'cancelled';

interface DraftRequest {
  client_id?: string;
  week_start?: string;
}

interface DraftItem {
  item_type: PlanItemType;
  scheduled_date: string | null;
  title: string;
  details: string | null;
  confirmation_status: ConfirmationStatus;
  linked_assignment_id?: string | null;
  linked_phase_index?: number | null;
  linked_day_index?: number | null;
}

const SYSTEM = `You are Pedro Avila's weekly lifestyle coaching planning assistant.

Return only valid JSON. No markdown. No commentary.

Create a weekly plan that Pedro can review before publishing to the client.
The plan should combine in-person PT, solo strength, running, golf mobility/prep, recovery, nutrition, and check-in/review where useful.

JSON schema:
{
  "coach_summary": "Private concise summary for Pedro",
  "client_note": "Short client-facing note for the week",
  "regular_slot": "Regular slot text or null",
  "regular_slot_status": "unconfirmed | confirmed | moved | cancelled",
  "items": [
    {
      "item_type": "pt_session | solo_strength | run | golf_mobility | recovery | nutrition | check_in",
      "scheduled_date": "YYYY-MM-DD or null",
      "title": "Short client-facing title",
      "details": "Concrete instructions or context",
      "confirmation_status": "none | needs_confirmation | confirmed | moved | cancelled",
      "linked_assignment_id": "active assignment id or null",
      "linked_phase_index": 0,
      "linked_day_index": 0
    }
  ]
}

Rules:
- Use dates within the supplied week range only.
- Keep client-facing item titles short and practical.
- Include one in-person PT session if a regular slot exists, with confirmation_status confirmed if the slot is stable or needs_confirmation if the reset suggests uncertainty.
- Include one check-in item on Friday with item_type check_in, title "Weekly check-in", and a short client-facing note reminding the client to complete it.
- Include no more than 7 plan items unless the reset clearly requires it.
- For solo_strength items, link to the active assignment and use zero-based phase/day indexes when the active programme context provides a suitable day.
- Do not make medical claims. For pain, soreness, injury, or GLP-1/medication topics, write a conservative planning note for Pedro and suggest checking in.
- Pedro is the final decision maker; this is a draft only.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json('ok', 200);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization.' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) return json({ error: 'OPENAI_API_KEY is not configured.' }, 500);

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
      return json({ error: 'Only Pedro can draft weekly plans.' }, 403);
    }

    const body = (await req.json()) as DraftRequest;
    const clientId = body.client_id;
    const weekStart = body.week_start;
    if (!clientId || !weekStart) return json({ error: 'Missing client_id or week_start.' }, 400);

    const weekEnd = addDays(weekStart, 6);
    const [
      { data: client },
      { data: checkins },
      { data: metrics },
      { data: goals },
      { data: assignments },
      { data: notes },
    ] = await Promise.all([
      adminClient
        .from('pt_clients')
        .select('id, name, email, goals, notes, lifestyle_context, regular_training_slot, coaching_focus, event_goal')
        .eq('id', clientId)
        .single(),
      adminClient
        .from('pt_weekly_checkins')
        .select('*')
        .eq('client_id', clientId)
        .order('week_start', { ascending: false })
        .limit(3),
      adminClient
        .from('pt_client_metrics')
        .select('*')
        .eq('client_id', clientId)
        .order('measured_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(4),
      adminClient
        .from('pt_client_goals')
        .select('*')
        .eq('client_id', clientId)
        .eq('status', 'active')
        .order('created_at', { ascending: false }),
      adminClient
        .from('pt_program_assignments')
        .select('id, name, goal, current_phase_index, current_week, current_block_index, programme')
        .eq('client_id', clientId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1),
      adminClient
        .from('pt_client_notes')
        .select('content, created_at, context')
        .eq('client_id', clientId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(8),
    ]);

    if (!client) return json({ error: 'Client not found.' }, 404);

    const activeAssignment = (assignments ?? [])[0] ?? null;
    const programmePreview = activeAssignment ? summariseProgramme(activeAssignment) : null;

    const openai = new OpenAI({ apiKey: openaiKey });
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0.25,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: JSON.stringify({
            week_start: weekStart,
            week_end: weekEnd,
            client,
            latest_checkins: checkins ?? [],
            recent_metrics: metrics ?? [],
            active_goals: goals ?? [],
            active_assignment: programmePreview,
            open_notes: notes ?? [],
          }),
        },
      ],
    });

    const parsed = JSON.parse(response.choices[0]?.message.content ?? '{}') as {
      coach_summary?: string;
      client_note?: string;
      regular_slot?: string | null;
      regular_slot_status?: string;
      items?: DraftItem[];
    };

    return json({
      coach_summary: parsed.coach_summary ?? '',
      client_note: parsed.client_note ?? '',
      regular_slot: parsed.regular_slot ?? client.regular_training_slot ?? null,
      regular_slot_status: normaliseSlotStatus(parsed.regular_slot_status),
      items: normaliseItems(parsed.items ?? [], weekStart, weekEnd, activeAssignment?.id ?? null),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Weekly plan draft failed.' }, 500);
  }
});

function normaliseItems(items: DraftItem[], weekStart: string, weekEnd: string, assignmentId: string | null) {
  const mapped = items
    .filter((item) => isPlanItemType(item.item_type) && item.title?.trim())
    .slice(0, 8)
    .map((item, index) => ({
      item_type: item.item_type,
      scheduled_date: item.scheduled_date && item.scheduled_date >= weekStart && item.scheduled_date <= weekEnd
        ? item.scheduled_date
        : null,
      title: item.title.trim().slice(0, 120),
      details: item.details?.trim() ? item.details.trim().slice(0, 700) : null,
      confirmation_status: normaliseConfirmation(item.confirmation_status),
      linked_assignment_id: item.linked_assignment_id === assignmentId ? assignmentId : null,
      linked_phase_index: typeof item.linked_phase_index === 'number' ? item.linked_phase_index : null,
      linked_day_index: typeof item.linked_day_index === 'number' ? item.linked_day_index : null,
      sort_order: index,
    }));

  if (mapped.some((item) => item.item_type === 'check_in')) {
    return mapped.slice(0, 7);
  }

  return [
    ...mapped.slice(0, 6),
    {
      item_type: 'check_in' as const,
      scheduled_date: addDays(weekStart, 4),
      title: 'Weekly check-in',
      details: 'Complete your weekly check-in.',
      confirmation_status: 'none' as const,
      linked_assignment_id: null,
      linked_phase_index: null,
      linked_day_index: null,
      sort_order: mapped.length,
    },
  ];
}

function summariseProgramme(assignment: { id: string; name: string; goal: string | null; current_phase_index: number | null; current_week: number | null; current_block_index: number | null; programme: unknown }) {
  const programme = assignment.programme as {
    phases?: Array<{
      title?: string;
      focus?: string;
      days?: Array<{ title?: string; focus?: string }>;
    }>;
  };

  return {
    id: assignment.id,
    name: assignment.name,
    goal: assignment.goal,
    current_phase_index: assignment.current_phase_index,
    current_week: assignment.current_week,
    current_block_index: assignment.current_block_index,
    phases: (programme.phases ?? []).map((phase, phaseIndex) => ({
      phase_index: phaseIndex,
      title: phase.title,
      focus: phase.focus,
      days: (phase.days ?? []).map((day, dayIndex) => ({
        day_index: dayIndex,
        title: day.title,
        focus: day.focus,
      })),
    })),
  };
}

function isPlanItemType(value: string): value is PlanItemType {
  return ['pt_session', 'solo_strength', 'run', 'golf_mobility', 'recovery', 'nutrition', 'check_in'].includes(value);
}

function normaliseConfirmation(value: string | undefined): ConfirmationStatus {
  if (value === 'needs_confirmation' || value === 'confirmed' || value === 'moved' || value === 'cancelled') return value;
  return 'none';
}

function normaliseSlotStatus(value: string | undefined) {
  if (value === 'confirmed' || value === 'moved' || value === 'cancelled') return value;
  return 'unconfirmed';
}

function addDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
