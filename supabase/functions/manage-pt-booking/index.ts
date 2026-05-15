import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PEDRO_EMAILS = ['pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au'];
const TIMEZONE = 'Australia/Sydney';
const INTERNAL_SECRET_FALLBACK = 'cerebro-cron-2026';
const MIN_NOTICE_MS = 12 * 60 * 60 * 1000;
const HORIZON_MS = 28 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type Action = 'create' | 'cancel' | 'complete' | 'no_show' | 'review_cancellation' | 'send_weekly_reminders' | 'send_session_alerts';
type BookingStatus = 'scheduled' | 'confirmed' | 'cancellation_requested' | 'completed' | 'cancelled' | 'no_show';

interface RequestBody {
  action?: Action;
  client_id?: string;
  appointment_id?: string;
  start_at?: string;
  recurring_weeks?: number;
  reason?: string;
  approved?: boolean;
  review_note?: string;
  notes?: string;
}

interface PTClientRow {
  id: string;
  name: string;
  email: string;
  user_id: string | null;
  sessions_remaining: number;
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

interface AppointmentRow {
  id: string;
  client_id: string;
  start_at: string;
  end_at: string;
  timezone: string;
  status: BookingStatus;
  google_calendar_event_id: string | null;
  location: string | null;
  pt_clients?: PTClientRow | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(url, serviceKey);
    const body = (await req.json()) as RequestBody;
    if (!body.action) return json({ error: 'Missing action.' }, 400);

    const internalSecret = Deno.env.get('CEREBRO_INTERNAL_SECRET') ?? INTERNAL_SECRET_FALLBACK;
    const bearer = authHeader?.replace(/^Bearer\s+/i, '') ?? '';
    if (body.action === 'send_weekly_reminders' && bearer && bearer === internalSecret) {
      return await sendWeeklyBookingReminders(adminClient);
    }

    if (body.action === 'send_session_alerts' && bearer && bearer === internalSecret) {
      return await sendSessionAlerts(adminClient);
    }

    if (!authHeader) return json({ error: 'Missing authorization.' }, 401);
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: 'Unauthorized.' }, 401);

    const requesterEmail = authData.user.email?.toLowerCase() ?? '';
    const { data: requesterProfile } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', authData.user.id)
      .maybeSingle();
    const isAdmin = requesterProfile?.role === 'admin' || PEDRO_EMAILS.includes(requesterEmail);

    if (body.action === 'create') {
      return await createBooking(adminClient, authData.user.id, isAdmin, body);
    }

    if (body.action === 'cancel') {
      return await cancelBooking(adminClient, authData.user.id, isAdmin, body);
    }

    if (body.action === 'complete') {
      if (!isAdmin) return json({ error: 'Only Pedro can complete sessions.' }, 403);
      return await completeBooking(adminClient, authData.user.id, body);
    }

    if (body.action === 'no_show') {
      if (!isAdmin) return json({ error: 'Only Pedro can mark no shows.' }, 403);
      return await noShowBooking(adminClient, authData.user.id, body);
    }

    if (body.action === 'review_cancellation') {
      if (!isAdmin) return json({ error: 'Only Pedro can review cancellations.' }, 403);
      return await reviewCancellation(adminClient, authData.user.id, body);
    }

    if (body.action === 'send_weekly_reminders') {
      if (!isAdmin) return json({ error: 'Only Pedro can send booking reminders.' }, 403);
      return await sendWeeklyBookingReminders(adminClient);
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Booking action failed.' }, 500);
  }
});

async function createBooking(adminClient: ReturnType<typeof createClient>, userId: string, isAdmin: boolean, body: RequestBody) {
  if (!body.start_at) return json({ error: 'Missing start_at.' }, 400);

  const client = await getClientForRequest(adminClient, userId, isAdmin, body.client_id);
  if (!client) return json({ error: 'Client not found.' }, 404);

  const firstStart = new Date(body.start_at);
  if (!Number.isFinite(firstStart.getTime())) return json({ error: 'Invalid start_at.' }, 400);

  const requestedRepeats = Math.max(1, Math.min(Number(body.recurring_weeks ?? 1), 4));
  const starts = Array.from({ length: requestedRepeats }, (_, index) => new Date(firstStart.getTime() + index * 7 * DAY_MS))
    .filter((date) => date.getTime() <= Date.now() + HORIZON_MS);

  if (starts.length === 0) return json({ error: 'No valid booking dates in the 28 day window.' }, 400);

  const { data: availabilityRows } = await adminClient.from('pt_booking_availability').select('*').eq('is_active', true);

  const availability = (availabilityRows ?? []) as AvailabilityRow[];
  if (client.sessions_remaining <= 0) {
    return json({ error: 'No sessions remaining. Contact Pedro to add more.' }, 400);
  }

  const occurrences: Array<{ start: Date; end: Date; availability: AvailabilityRow }> = [];
  for (const start of starts) {
    validateBookingWindow(start);
    const matching = matchingAvailability(start, availability);
    if (!matching) return json({ error: `No availability for ${formatDateTime(start)}.` }, 400);
    const sessionMinutes = sessionDurationMinutes(matching);
    const end = new Date(start.getTime() + sessionMinutes * 60000);
    if (!slotFitsWindow(start, end, matching)) return json({ error: `Selected slot is outside Pedro's availability on ${formatDateTime(start)}.` }, 400);
    occurrences.push({ start, end, availability: matching });
  }

  const rangeStart = new Date(Math.min(...occurrences.map((item) => item.start.getTime()))).toISOString();
  const rangeEnd = new Date(Math.max(...occurrences.map((item) => item.end.getTime() + bufferMinutes(item.availability) * 60000))).toISOString();
  const { data: blocks } = await adminClient
    .from('pt_booking_blocks')
    .select('start_at, end_at, status')
    .eq('status', 'active')
    .lt('start_at', rangeEnd)
    .gt('end_at', rangeStart);

  for (const occurrence of occurrences) {
    const clash = (blocks ?? []).some((block: { start_at: string; end_at: string }) =>
      occurrence.start.getTime() < new Date(block.end_at).getTime() && occurrence.end.getTime() > new Date(block.start_at).getTime(),
    );
    if (clash) return json({ error: `That slot is already taken: ${formatDateTime(occurrence.start)}.` }, 409);
  }

  const recurringGroupId = occurrences.length > 1 ? crypto.randomUUID() : null;
  const created: AppointmentRow[] = [];
  for (const occurrence of occurrences) {
    const { data: appointment, error } = await adminClient
      .from('pt_booking_appointments')
      .insert({
        client_id: client.id,
        start_at: occurrence.start.toISOString(),
        end_at: occurrence.end.toISOString(),
        timezone: TIMEZONE,
        status: 'confirmed',
        source: recurringGroupId ? 'recurring' : isAdmin ? 'coach' : 'client',
        recurring_group_id: recurringGroupId,
        location: occurrence.availability.location,
        confirmed_at: new Date().toISOString(),
        created_by: userId,
      })
      .select('*')
      .single();

    if (error || !appointment) return json({ error: error?.message ?? 'Could not create booking.' }, 400);
    const row = appointment as AppointmentRow;
    created.push(row);

    await adminClient.from('pt_booking_blocks').insert({
      appointment_id: row.id,
      start_at: row.start_at,
      end_at: new Date(occurrence.end.getTime() + bufferMinutes(occurrence.availability) * 60000).toISOString(),
      status: 'active',
    });

    const googleId = await syncGoogleCalendar('create', { appointment: row, client });
    if (googleId) {
      await adminClient.from('pt_booking_appointments').update({ google_calendar_event_id: googleId }).eq('id', row.id);
      row.google_calendar_event_id = googleId;
    }
    await sendBookingEmail(adminClient, 'booking_confirmation', client, row);
  }

  await adminClient.from('pt_events').insert({
    client_id: client.id,
    event_type: 'session_booked',
    metadata: {
      count: created.length,
      recurring_group_id: recurringGroupId,
      first_start_at: created[0]?.start_at,
    },
  });

  return json({ ok: true, appointments: created });
}

async function cancelBooking(adminClient: ReturnType<typeof createClient>, userId: string, isAdmin: boolean, body: RequestBody) {
  if (!body.appointment_id) return json({ error: 'Missing appointment_id.' }, 400);
  const appointment = await getAppointment(adminClient, body.appointment_id);
  if (!appointment) return json({ error: 'Booking not found.' }, 404);

  const client = appointment.pt_clients;
  if (!client) return json({ error: 'Client not found.' }, 404);
  if (!isAdmin && client.user_id !== userId) return json({ error: 'You cannot cancel this booking.' }, 403);

  const startsWithin24Hours = new Date(appointment.start_at).getTime() - Date.now() < DAY_MS;
  if (!isAdmin && startsWithin24Hours) {
    if (!body.reason?.trim()) return json({ error: 'Cancellation reason is required inside 24 hours.' }, 400);
    await adminClient.from('pt_booking_cancellation_requests').insert({
      appointment_id: appointment.id,
      client_id: appointment.client_id,
      reason: body.reason.trim(),
    });
    await adminClient.from('pt_booking_appointments').update({
      status: 'cancellation_requested',
      cancel_reason: body.reason.trim(),
      cancellation_requested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', appointment.id);
    await sendPedroNotice('Late cancellation request', `${client.name} requested to cancel ${formatDateTime(new Date(appointment.start_at))}.\n\nReason: ${body.reason.trim()}`);
    return json({ ok: true, status: 'cancellation_requested' });
  }

  await applyCancellation(adminClient, userId, appointment, body.reason ?? (isAdmin ? 'Cancelled by Pedro.' : 'Cancelled by client.'));
  await sendBookingEmail(adminClient, 'booking_cancelled', client, appointment);
  return json({ ok: true, status: 'cancelled' });
}

async function completeBooking(adminClient: ReturnType<typeof createClient>, userId: string, body: RequestBody) {
  if (!body.appointment_id) return json({ error: 'Missing appointment_id.' }, 400);
  const appointment = await getAppointment(adminClient, body.appointment_id);
  if (!appointment) return json({ error: 'Booking not found.' }, 404);
  if (appointment.status === 'completed') return json({ ok: true, status: 'completed' });
  const client = appointment.pt_clients;
  if (!client) return json({ error: 'Client not found.' }, 404);

  const nextBalance = Math.max(0, client.sessions_remaining - 1);
  await adminClient.from('pt_booking_appointments').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
    completed_by: userId,
    notes: body.notes?.trim() || appointment.location,
    updated_at: new Date().toISOString(),
  }).eq('id', appointment.id);
  await adminClient.from('pt_booking_blocks').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('appointment_id', appointment.id);
  await adminClient.from('pt_clients').update({ sessions_remaining: nextBalance, updated_at: new Date().toISOString() }).eq('id', client.id);
  await adminClient.from('pt_session_ledger').insert({
    client_id: client.id,
    appointment_id: appointment.id,
    entry_type: 'session_completed',
    quantity: -1,
    balance_after: nextBalance,
    notes: 'Session completed by Pedro.',
    created_by: userId,
  });
  await adminClient.from('pt_events').insert({
    client_id: client.id,
    event_type: 'pt_session_completed',
    metadata: { appointment_id: appointment.id, start_at: appointment.start_at, balance_after: nextBalance },
  });

  if ([2, 1, 0].includes(nextBalance)) {
    await sendCreditEmail(adminClient, client, nextBalance);
  }

  return json({ ok: true, status: 'completed', sessions_remaining: nextBalance });
}

async function noShowBooking(adminClient: ReturnType<typeof createClient>, userId: string, body: RequestBody) {
  if (!body.appointment_id) return json({ error: 'Missing appointment_id.' }, 400);
  const appointment = await getAppointment(adminClient, body.appointment_id);
  if (!appointment) return json({ error: 'Booking not found.' }, 404);
  if (appointment.status === 'no_show') return json({ ok: true, status: 'no_show' });
  const client = appointment.pt_clients;
  if (!client) return json({ error: 'Client not found.' }, 404);

  const nextBalance = Math.max(0, client.sessions_remaining - 1);
  await adminClient.from('pt_booking_appointments').update({
    status: 'no_show',
    completed_at: new Date().toISOString(),
    completed_by: userId,
    updated_at: new Date().toISOString(),
  }).eq('id', appointment.id);
  await adminClient.from('pt_booking_blocks').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('appointment_id', appointment.id);
  await adminClient.from('pt_clients').update({ sessions_remaining: nextBalance, updated_at: new Date().toISOString() }).eq('id', client.id);
  await adminClient.from('pt_session_ledger').insert({
    client_id: client.id,
    appointment_id: appointment.id,
    entry_type: 'no_show',
    quantity: -1,
    balance_after: nextBalance,
    notes: 'Client did not show for session.',
    created_by: userId,
  });
  await adminClient.from('pt_events').insert({
    client_id: client.id,
    event_type: 'pt_session_no_show',
    metadata: { appointment_id: appointment.id, start_at: appointment.start_at, balance_after: nextBalance },
  });

  if ([2, 1, 0].includes(nextBalance)) {
    await sendCreditEmail(adminClient, client, nextBalance);
  }

  return json({ ok: true, status: 'no_show', sessions_remaining: nextBalance });
}

async function sendSessionAlerts(adminClient: ReturnType<typeof createClient>) {
  const now = new Date();
  const in24h = new Date(now.getTime() + DAY_MS);

  const { data: clients, error: clientError } = await adminClient
    .from('pt_clients')
    .select('id, name, email, user_id, sessions_remaining')
    .neq('status', 'archived')
    .lte('sessions_remaining', 1);

  if (clientError) return json({ error: clientError.message }, 500);

  const todayDate = now.toISOString().slice(0, 10);
  let sent = 0;

  for (const client of (clients ?? []) as PTClientRow[]) {
    const { data: upcoming } = await adminClient
      .from('pt_booking_appointments')
      .select('id, start_at')
      .eq('client_id', client.id)
      .in('status', ['scheduled', 'confirmed'])
      .gte('start_at', now.toISOString())
      .lt('start_at', in24h.toISOString())
      .order('start_at', { ascending: true })
      .limit(1);

    const nextAppt = (upcoming ?? [])[0];
    if (!nextAppt) continue;

    const notifType = client.sessions_remaining === 0 ? 'zero_sessions_upcoming' : 'last_session_upcoming';

    const { data: existing } = await adminClient
      .from('pt_notification_log')
      .select('id')
      .eq('client_id', client.id)
      .eq('notification_type', notifType)
      .gte('created_at', `${todayDate}T00:00:00Z`)
      .limit(1);

    if ((existing ?? []).length > 0) continue;

    const apptDate = formatDateTime(new Date(nextAppt.start_at));

    let subject: string;
    let text: string;

    if (client.sessions_remaining === 0) {
      subject = 'Your upcoming PT session — no sessions remaining';
      text = `Hi ${client.name},\n\nYou have a PT session booked for ${apptDate}, but you currently have no sessions remaining. This session will not be able to go ahead.\n\nPlease make a payment as soon as possible to continue your training.\n\nPedro`;
    } else {
      subject = 'Your last PT session is coming up';
      text = `Hi ${client.name},\n\nYour next session with Pedro is booked for ${apptDate}.\n\nAfter this session you will have no sessions remaining. Please make a payment when possible to keep your training going.\n\nPedro`;
    }

    await sendEmail(client.email, subject, text);
    await adminClient.from('pt_notification_log').insert({
      client_id: client.id,
      appointment_id: nextAppt.id,
      notification_type: notifType,
      recipient_email: client.email,
      subject,
      metadata: { sessions_remaining: client.sessions_remaining },
    });
    sent += 1;
  }

  return json({ ok: true, sent });
}

async function reviewCancellation(adminClient: ReturnType<typeof createClient>, userId: string, body: RequestBody) {
  if (!body.appointment_id) return json({ error: 'Missing appointment_id.' }, 400);
  const appointment = await getAppointment(adminClient, body.appointment_id);
  if (!appointment) return json({ error: 'Booking not found.' }, 404);

  const { data: request } = await adminClient
    .from('pt_booking_cancellation_requests')
    .select('*')
    .eq('appointment_id', appointment.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!request) return json({ error: 'No pending cancellation request.' }, 404);

  if (body.approved) {
    await adminClient.from('pt_booking_cancellation_requests').update({
      status: 'approved',
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      review_note: body.review_note?.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', request.id);
    await applyCancellation(adminClient, userId, appointment, request.reason);
    if (appointment.pt_clients) await sendBookingEmail(adminClient, 'booking_cancelled', appointment.pt_clients, appointment);
    return json({ ok: true, status: 'approved' });
  }

  await adminClient.from('pt_booking_cancellation_requests').update({
    status: 'rejected',
    reviewed_by: userId,
    reviewed_at: new Date().toISOString(),
    review_note: body.review_note?.trim() || null,
    updated_at: new Date().toISOString(),
  }).eq('id', request.id);
  await adminClient.from('pt_booking_appointments').update({
    status: 'confirmed',
    updated_at: new Date().toISOString(),
  }).eq('id', appointment.id);
  return json({ ok: true, status: 'rejected' });
}

async function sendWeeklyBookingReminders(adminClient: ReturnType<typeof createClient>) {
  const weekStart = nextMondayInputValue();
  const weekEnd = addDaysInputValue(weekStart, 7);
  const rangeStart = `${weekStart}T00:00:00+10:00`;
  const rangeEnd = `${weekEnd}T00:00:00+10:00`;

  const { data: clients, error: clientError } = await adminClient
    .from('pt_clients')
    .select('id, name, email, user_id, sessions_remaining')
    .neq('status', 'archived')
    .gt('sessions_remaining', 0);

  if (clientError) return json({ error: clientError.message }, 500);

  let sent = 0;
  let skipped = 0;

  for (const client of (clients ?? []) as PTClientRow[]) {
    const [{ data: appointments }, { data: existingLog }] = await Promise.all([
      adminClient
        .from('pt_booking_appointments')
        .select('id')
        .eq('client_id', client.id)
        .in('status', ['scheduled', 'confirmed', 'cancellation_requested'])
        .gte('start_at', rangeStart)
        .lt('start_at', rangeEnd)
        .limit(1),
      adminClient
        .from('pt_notification_log')
        .select('id')
        .eq('client_id', client.id)
        .eq('notification_type', 'weekly_booking_reminder')
        .eq('metadata->>week_start', weekStart)
        .limit(1),
    ]);

    if ((appointments ?? []).length > 0 || (existingLog ?? []).length > 0) {
      skipped += 1;
      continue;
    }

    const subject = 'Book your PT session for next week';
    const text = `Hi ${client.name},\n\nYou do not have a PT session booked with Pedro for next week yet. Jump into your client dashboard and pick one of the available morning slots.\n\nPedro`;
    await sendEmail(client.email, subject, text);
    await adminClient.from('pt_notification_log').insert({
      client_id: client.id,
      notification_type: 'weekly_booking_reminder',
      recipient_email: client.email,
      subject,
      metadata: { week_start: weekStart },
    });
    sent += 1;
  }

  return json({ ok: true, week_start: weekStart, sent, skipped });
}

async function applyCancellation(adminClient: ReturnType<typeof createClient>, userId: string, appointment: AppointmentRow, reason: string) {
  await adminClient.from('pt_booking_appointments').update({
    status: 'cancelled',
    cancel_reason: reason,
    cancelled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', appointment.id);
  await adminClient.from('pt_booking_blocks').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('appointment_id', appointment.id);
  await syncGoogleCalendar('cancel', { appointment, client: appointment.pt_clients ?? null });
}

async function getClientForRequest(adminClient: ReturnType<typeof createClient>, userId: string, isAdmin: boolean, requestedClientId?: string) {
  let query = adminClient.from('pt_clients').select('id, name, email, user_id, sessions_remaining').neq('status', 'archived');
  query = isAdmin && requestedClientId ? query.eq('id', requestedClientId) : query.eq('user_id', userId);
  const { data } = await query.limit(1).maybeSingle();
  return data as PTClientRow | null;
}

async function getAppointment(adminClient: ReturnType<typeof createClient>, appointmentId: string) {
  const { data } = await adminClient
    .from('pt_booking_appointments')
    .select('*, pt_clients(id, name, email, user_id, sessions_remaining)')
    .eq('id', appointmentId)
    .maybeSingle();
  return data as AppointmentRow | null;
}

function validateBookingWindow(start: Date) {
  const now = Date.now();
  if (start.getTime() < now + MIN_NOTICE_MS) throw new Error('Bookings need at least 12 hours notice.');
  if (start.getTime() > now + HORIZON_MS) throw new Error('Bookings can only be made up to 28 days ahead.');
}

function matchingAvailability(start: Date, availability: AvailabilityRow[]) {
  const local = localParts(start);
  return availability.find((window) =>
    window.day_of_week === local.dayOfWeek &&
    local.minutes >= timeToMinutes(window.start_time) &&
    local.minutes + sessionDurationMinutes(window) <= timeToMinutes(window.end_time),
  );
}

function slotFitsWindow(start: Date, end: Date, window: AvailabilityRow) {
  const startLocal = localParts(start);
  const endLocal = localParts(end);
  return startLocal.dayOfWeek === window.day_of_week &&
    endLocal.dayOfWeek === window.day_of_week &&
    startLocal.minutes >= timeToMinutes(window.start_time) &&
    endLocal.minutes <= timeToMinutes(window.end_time);
}

function localParts(date: Date) {
  const formatter = new Intl.DateTimeFormat('en-AU', {
    timeZone: TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dayOfWeek: dayMap[weekday] ?? 1, minutes: hour * 60 + minute };
}

function timeToMinutes(value: string) {
  const [hour, minute] = value.slice(0, 5).split(':').map(Number);
  return hour * 60 + minute;
}

function sessionDurationMinutes(window: AvailabilityRow) {
  return Number(window.session_duration_minutes ?? 45);
}

function bufferMinutes(window: AvailabilityRow) {
  return Number(window.buffer_minutes ?? Math.max(0, Number(window.slot_duration_minutes ?? 50) - sessionDurationMinutes(window)));
}

function formatDateTime(date: Date) {
  return date.toLocaleString('en-AU', {
    timeZone: TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function nextMondayInputValue() {
  const now = new Date();
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(now);
  const year = Number(local.find((part) => part.type === 'year')?.value ?? now.getUTCFullYear());
  const month = Number(local.find((part) => part.type === 'month')?.value ?? now.getUTCMonth() + 1);
  const day = Number(local.find((part) => part.type === 'day')?.value ?? now.getUTCDate());
  const weekday = local.find((part) => part.type === 'weekday')?.value ?? 'Mon';
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const currentDay = dayMap[weekday] ?? 1;
  const daysUntilNextMonday = ((8 - currentDay) % 7) || 7;
  const date = new Date(Date.UTC(year, month - 1, day + daysUntilNextMonday));
  return dateInputValue(date);
}

function addDaysInputValue(input: string, days: number) {
  const date = new Date(`${input}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateInputValue(date);
}

function dateInputValue(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

async function syncGoogleCalendar(action: 'create' | 'cancel', input: { appointment: AppointmentRow; client: PTClientRow | null }) {
  const webhook = Deno.env.get('GOOGLE_CALENDAR_SYNC_URL');
  if (webhook) {
    try {
      const response = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...input }),
      });
      if (!response.ok) {
        console.error('Google Calendar sync webhook failed:', response.status, response.statusText);
        return null;
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) return null;

      const payload = (await response.json()) as { id?: string; event_id?: string; google_calendar_event_id?: string };
      return payload.id ?? payload.event_id ?? payload.google_calendar_event_id ?? null;
    } catch (error) {
      console.error('Google Calendar sync webhook error:', error);
      return null;
    }
  }

  const accessToken = Deno.env.get('GOOGLE_CALENDAR_ACCESS_TOKEN');
  const calendarId = Deno.env.get('GOOGLE_CALENDAR_ID') ?? 'primary';
  if (!accessToken) return null;

  try {
    if (action === 'cancel') {
      if (!input.appointment.google_calendar_event_id) return null;
      await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(input.appointment.google_calendar_event_id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return null;
    }

    const coachEmail = Deno.env.get('COACH_CALENDAR_EMAIL') ?? 'avila.phm@gmail.com';
    const attendees: Array<{ email: string }> = [];
    if (input.client?.email) attendees.push({ email: input.client.email });
    if (coachEmail) attendees.push({ email: coachEmail });

    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: `PT Session - ${input.client?.name ?? 'Client'}`,
        description: `Booked through Pedro Avila Coaching.${input.appointment.location ? `\nLocation: ${input.appointment.location}` : ''}`,
        start: { dateTime: input.appointment.start_at, timeZone: TIMEZONE },
        end: { dateTime: input.appointment.end_at, timeZone: TIMEZONE },
        attendees,
      }),
    });
    if (!res.ok) {
      console.error('Google Calendar sync API failed:', res.status, res.statusText);
      return null;
    }

    const data = (await res.json()) as { id?: string };
    return data.id ?? null;
  } catch (error) {
    console.error('Google Calendar sync API error:', error);
    return null;
  }
}

async function sendBookingEmail(adminClient: ReturnType<typeof createClient>, type: 'booking_confirmation' | 'booking_cancelled', client: PTClientRow, appointment: AppointmentRow) {
  const subject = type === 'booking_confirmation' ? 'Your PT session is booked' : 'Your PT session was cancelled';
  const text = type === 'booking_confirmation'
    ? `Hi ${client.name},\n\nYour session with Pedro is booked for ${formatDateTime(new Date(appointment.start_at))}.\n\nPedro`
    : `Hi ${client.name},\n\nYour session with Pedro on ${formatDateTime(new Date(appointment.start_at))} has been cancelled.\n\nPedro`;
  await sendEmail(client.email, subject, text);
  await adminClient.from('pt_notification_log').insert({
    client_id: client.id,
    appointment_id: appointment.id,
    notification_type: type,
    recipient_email: client.email,
    subject,
  });

  if (type === 'booking_confirmation') {
    try {
      const coachEmail = Deno.env.get('COACH_NOTIFY_EMAIL') ?? 'pedro@cerebroai.au';
      const coachSubject = `[Cerebro Booking] ${client.name} — ${formatDateTime(new Date(appointment.start_at))}`;
      const coachText = `New PT session booked.\n\nClient: ${client.name} <${client.email}>\nWhen: ${formatDateTime(new Date(appointment.start_at))}\n${appointment.location ? `Location: ${appointment.location}\n` : ''}\nThe attached booking.ics adds this session to your calendar in one click.\n\nCoach copy.`;
      const ics = buildIcsForBooking(client, appointment);
      await sendEmail(coachEmail, coachSubject, coachText, [ics]);
      await adminClient.from('pt_notification_log').insert({
        client_id: client.id,
        appointment_id: appointment.id,
        notification_type: 'coach_booking_notification',
        recipient_email: coachEmail,
        subject: coachSubject,
      });
    } catch (error) {
      console.error('Coach booking notification failed:', error);
    }
  }
}

async function sendCreditEmail(adminClient: ReturnType<typeof createClient>, client: PTClientRow, balance: number) {
  const subject = balance === 0 ? 'You have no PT sessions left' : `You have ${balance} PT session${balance === 1 ? '' : 's'} left`;
  const text = balance === 0
    ? `Hi ${client.name},\n\nYou have no PT sessions remaining with Pedro. You won't be able to book new sessions until another pack is added. Please contact Pedro to continue your training.\n\nPedro`
    : balance === 1
      ? `Hi ${client.name},\n\nYou have 1 PT session remaining with Pedro. Once that session is complete, your pack will be finished. Please arrange payment when possible to keep your training going.\n\nPedro`
      : `Hi ${client.name},\n\nYou have ${balance} PT sessions remaining with Pedro.\n\nPedro`;
  await sendEmail(client.email, subject, text);
  await adminClient.from('pt_notification_log').insert({
    client_id: client.id,
    notification_type: `sessions_left_${balance}`,
    recipient_email: client.email,
    subject,
  });
}

async function sendPedroNotice(subject: string, text: string) {
  await sendEmail(Deno.env.get('PEDRO_EMAIL') ?? 'pedro@meetavila.com', subject, text);
}

interface EmailAttachment { filename: string; content: string; content_type?: string }

async function sendEmail(to: string, subject: string, text: string, attachments?: EmailAttachment[]) {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return;
  const body: Record<string, unknown> = {
    from: Deno.env.get('RESEND_FROM_PEDRO_NOTIFY') ?? 'Pedro Avila Coaching <onboarding@resend.dev>',
    to,
    subject,
    text,
  };
  if (attachments && attachments.length > 0) body.attachments = attachments;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function icsTimestamp(date: Date) {
  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`;
}

function pad2(n: number) { return String(n).padStart(2, '0'); }

function buildIcsForBooking(client: PTClientRow, appointment: AppointmentRow): EmailAttachment {
  const now = new Date();
  const start = new Date(appointment.start_at);
  const end = new Date(appointment.end_at);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cerebro//PT Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${appointment.id}@cerebroai.au`,
    `DTSTAMP:${icsTimestamp(now)}`,
    `DTSTART:${icsTimestamp(start)}`,
    `DTEND:${icsTimestamp(end)}`,
    `SUMMARY:PT Session - ${client.name}`,
    `DESCRIPTION:PT session booked via Cerebro. Client: ${client.name} <${client.email}>`,
    appointment.location ? `LOCATION:${appointment.location}` : '',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
  const bytes = new TextEncoder().encode(lines);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const content = btoa(binary);
  return { filename: 'booking.ics', content, content_type: 'text/calendar' };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
