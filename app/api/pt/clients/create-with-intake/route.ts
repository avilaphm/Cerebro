import { createHash, randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isPedroAdminEmail } from '@/utils/pt/access';
import {
  MOVEMENT_ASSESSMENT_SESSION_MINUTES,
} from '@/utils/pt/movement-assessment-booking';
import { formatBookingDate, formatBookingTime } from '@/utils/pt/bookings';
import { createAdminClient } from '@/utils/supabase/admin';
import { createClient } from '@/utils/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RequestBody {
  name?: unknown;
  email?: unknown;
  goals?: unknown;
  notes?: unknown;
  send_parq?: unknown;
  already_booked?: unknown;
  appointment_start_at?: unknown;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.role !== 'admin' && !isPedroAdminEmail(user.email)) {
    return NextResponse.json({ ok: false, error: 'Only Pedro can create this intake.' }, { status: 403 });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const name = cleanText(body.name, 160);
  const email = cleanText(body.email, 160).toLowerCase();
  const goals = cleanText(body.goals, 1000);
  const notes = cleanText(body.notes, 2000);
  const sendParq = body.send_parq !== false;
  const alreadyBooked = body.already_booked === true;
  const appointmentStartAt = cleanText(body.appointment_start_at, 80);

  if (!name) return NextResponse.json({ ok: false, error: 'Client name is required.' }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ ok: false, error: 'A valid email is required.' }, { status: 400 });

  let startAt: string | null = null;
  if (alreadyBooked) {
    const parsedStart = new Date(appointmentStartAt);
    if (!appointmentStartAt || Number.isNaN(parsedStart.getTime()) || parsedStart <= new Date()) {
      return NextResponse.json({ ok: false, error: 'Choose a future date and time.' }, { status: 400 });
    }
    startAt = parsedStart.toISOString();
  }

  const admin = createAdminClient();
  try {
    const existingRes = await admin
      .from('pt_clients')
      .select('*')
      .ilike('email', email)
      .maybeSingle();
    if (existingRes.error) throw existingRes.error;

    let client = existingRes.data;
    if (client) {
      const updateRes = await admin
        .from('pt_clients')
        .update({
          name,
          goals: goals || client.goals,
          notes: notes || client.notes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', client.id)
        .select()
        .single();
      if (updateRes.error) throw updateRes.error;
      client = updateRes.data;
    } else {
      const insertRes = await admin
        .from('pt_clients')
        .insert({
          name,
          email,
          goals: goals || null,
          notes: notes || null,
          status: 'invited',
          use_brain: true,
          sessions_remaining: 0,
        })
        .select()
        .single();
      if (insertRes.error || !insertRes.data) throw insertRes.error ?? new Error('Could not create client.');
      client = insertRes.data;
    }

    let appointment: { id: string; start_at: string; end_at: string; location: string | null } | null = null;
    let calendarSynced = false;

    if (startAt) {
      const endAt = new Date(new Date(startAt).getTime() + MOVEMENT_ASSESSMENT_SESSION_MINUTES * 60_000).toISOString();
      const appointmentRes = await admin
        .from('pt_booking_appointments')
        .insert({
          client_id: client.id,
          start_at: startAt,
          end_at: endAt,
          timezone: 'Australia/Sydney',
          status: 'confirmed',
          source: 'coach',
          location: null,
          notes: 'Movement Assessment booked by Pedro before the PAR-Q invitation.',
          confirmed_at: new Date().toISOString(),
          created_by: user.id,
        })
        .select('id, start_at, end_at, location')
        .single();
      if (appointmentRes.error || !appointmentRes.data) throw appointmentRes.error ?? new Error('Could not create appointment.');
      appointment = appointmentRes.data;

      const blockRes = await admin.from('pt_booking_blocks').insert({
        appointment_id: appointment.id,
        start_at: appointment.start_at,
        end_at: new Date(new Date(appointment.end_at).getTime() + 5 * 60_000).toISOString(),
        status: 'active',
      });
      if (blockRes.error) throw blockRes.error;

      calendarSynced = await syncAssessmentCalendar(appointment.id);
      await admin.from('pt_events').insert({
        client_id: client.id,
        event_type: 'session_booked',
        metadata: {
          source: 'coach_prebooked_movement_assessment',
          appointment_id: appointment.id,
          first_start_at: appointment.start_at,
          session_minutes: MOVEMENT_ASSESSMENT_SESSION_MINUTES,
        },
      });
    }

    let parqSent = false;
    if (sendParq) {
      const rawToken = randomBytes(32).toString('base64url');
      const tokenHash = hashToken(rawToken);
      const inviteRes = await admin
        .from('pt_movement_assessment_invites')
        .insert({
          client_id: client.id,
          appointment_id: appointment?.id ?? null,
          token_hash: tokenHash,
          expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          created_by: user.id,
        })
        .select('id')
        .single();
      if (inviteRes.error) throw inviteRes.error;

      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
      const link = `${baseUrl.replace(/\/$/, '')}/movement-assessment?token=${encodeURIComponent(rawToken)}`;
      parqSent = await sendParqEmail({
        name,
        email,
        link,
        appointmentStartAt: appointment?.start_at ?? null,
      });

      if (parqSent) {
        await admin
          .from('pt_movement_assessment_invites')
          .update({ sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', inviteRes.data.id);
      }
    }

    return NextResponse.json({
      ok: true,
      client,
      appointment,
      parq_sent: parqSent,
      calendar_synced: calendarSynced,
      warning: sendParq && !parqSent
        ? 'The client was created, but the PAR-Q email could not be sent. Check the email service and resend it.'
        : startAt && !calendarSynced
          ? 'The client and appointment were created, but Google Calendar did not confirm the sync.'
          : null,
    });
  } catch (error) {
    console.error('Create client intake failed', error);
    return NextResponse.json({ ok: false, error: 'Could not create the client intake.' }, { status: 500 });
  }
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

async function syncAssessmentCalendar(appointmentId: string) {
  const secret = process.env.ASSESSMENT_CAL_SYNC_SECRET;
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!secret || !baseUrl) return false;

  try {
    const response = await fetch(`${baseUrl}/functions/v1/sync-assessment-calendar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ appointment_id: appointmentId }),
    });
    if (!response.ok) {
      console.error('sync-assessment-calendar returned', response.status, await response.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error('sync-assessment-calendar request failed', error);
    return false;
  }
}

async function sendParqEmail(input: {
  name: string;
  email: string;
  link: string;
  appointmentStartAt: string | null;
}) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return false;

  const firstName = input.name.split(/\s+/)[0] || input.name;
  const bookingCopy = input.appointmentStartAt
    ? `Your movement assessment is already booked for ${formatBookingDate(input.appointmentStartAt)} at ${formatBookingTime(input.appointmentStartAt)}.`
    : 'After the form, you can choose a time for your movement assessment.';
  const text = `Hi ${firstName},\n\nBefore your movement assessment, please complete this short PAR-Q form.\n\n${bookingCopy}\n\nComplete your PAR-Q: ${input.link}\n\nThis link is private and expires in 14 days.\n\nPedro Avila`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_PEDRO_NOTIFY ?? 'Pedro Avila Coaching <pedro@cerebroai.au>',
        to: input.email,
        subject: 'Complete your PAR-Q before your movement assessment',
        text,
      }),
    });
    if (!response.ok) console.error('PAR-Q invite email failed', response.status, await response.text());
    return response.ok;
  } catch (error) {
    console.error('PAR-Q invite email request failed', error);
    return false;
  }
}
