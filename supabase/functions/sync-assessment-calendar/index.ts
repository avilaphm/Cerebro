import { createClient } from 'npm:@supabase/supabase-js@2';

// Server-to-server only: the public Movement Assessment booking route (Next.js)
// creates the appointment, then calls this function to push it to Pedro's Google
// Calendar, exactly like regular client sessions (manage-pt-booking). Auth is a
// shared secret bearer, so this stays verify_jwt = false.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TIMEZONE = 'Australia/Sydney';

interface AppointmentRow {
  id: string;
  start_at: string;
  end_at: string;
  location: string | null;
  google_calendar_event_id: string | null;
  pt_clients?: { name: string | null; email: string | null } | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const expected = Deno.env.get('ASSESSMENT_CAL_SYNC_SECRET');
  const provided = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!expected || provided !== expected) return json({ error: 'Unauthorized.' }, 401);

  let appointmentId: string | undefined;
  try {
    ({ appointment_id: appointmentId } = (await req.json()) as { appointment_id?: string });
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  if (!appointmentId) return json({ error: 'Missing appointment_id.' }, 400);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data, error } = await admin
    .from('pt_booking_appointments')
    .select('id, start_at, end_at, location, google_calendar_event_id, pt_clients(name, email)')
    .eq('id', appointmentId)
    .single();

  if (error || !data) return json({ error: 'Appointment not found.' }, 404);
  const appointment = data as AppointmentRow;
  if (appointment.google_calendar_event_id) {
    return json({ ok: true, already_synced: true, event_id: appointment.google_calendar_event_id });
  }

  const eventId = await createCalendarEvent(appointment);
  if (eventId) {
    await admin
      .from('pt_booking_appointments')
      .update({ google_calendar_event_id: eventId })
      .eq('id', appointment.id);
  }

  return json({ ok: true, event_id: eventId });
});

async function getGoogleAccessToken(): Promise<string | null> {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  const refreshToken = Deno.env.get('GOOGLE_REFRESH_TOKEN');
  if (clientId && clientSecret && refreshToken) {
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });
      if (res.ok) {
        const tokenData = (await res.json()) as { access_token?: string };
        if (tokenData.access_token) return tokenData.access_token;
        console.error('Google token refresh returned no access token.');
      } else {
        const errorBody = await res.text();
        console.error('Google token refresh failed:', res.status, errorBody.slice(0, 500));
      }
    } catch (tokenError) {
      console.error('Google token refresh error:', tokenError);
    }
  }
  return Deno.env.get('GOOGLE_CALENDAR_ACCESS_TOKEN') ?? null;
}

async function createCalendarEvent(appointment: AppointmentRow): Promise<string | null> {
  const calendarId = Deno.env.get('GOOGLE_CALENDAR_ID') ?? 'primary';
  const accessToken = await getGoogleAccessToken();
  if (!accessToken) {
    console.error('No Google access token available; skipping calendar sync.');
    return null;
  }

  const coachEmail = Deno.env.get('COACH_CALENDAR_EMAIL') ?? 'avila.phm@gmail.com';
  const clientName = appointment.pt_clients?.name ?? 'Client';
  const attendees: Array<{ email: string }> = [];
  if (appointment.pt_clients?.email) attendees.push({ email: appointment.pt_clients.email });
  if (coachEmail) attendees.push({ email: coachEmail });

  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: `Movement Assessment - ${clientName}`,
          description: `Movement assessment booked through Pedro Avila Coaching.${appointment.location ? `\nLocation: ${appointment.location}` : ''}`,
          start: { dateTime: appointment.start_at, timeZone: TIMEZONE },
          end: { dateTime: appointment.end_at, timeZone: TIMEZONE },
          attendees,
        }),
      },
    );
    if (!res.ok) {
      console.error('Google Calendar create failed:', res.status, res.statusText);
      return null;
    }
    const eventData = (await res.json()) as { id?: string };
    return eventData.id ?? null;
  } catch (calendarError) {
    console.error('Google Calendar sync error:', calendarError);
    return null;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
