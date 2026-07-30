import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { formatBookingDate, formatBookingTime } from '@/utils/pt/bookings';
import { MOVEMENT_ASSESSMENT_SESSION_MINUTES } from '@/utils/pt/movement-assessment-booking';
import { PAR_Q_CONSENT_TEXT, PAR_Q_QUESTIONS, type ParQAnswer } from '@/utils/pt/parq';
import { buildParqPdf } from '@/utils/pt/parq-pdf';
import { createAdminClient } from '@/utils/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PARQ_BUCKET = 'pt-client-docs';

interface SubmissionBody {
  token?: unknown;
  date_of_birth?: unknown;
  answers?: unknown;
  other_medical_note?: unknown;
  signature_data_url?: unknown;
  coach_notes?: unknown;
}

interface InviteRow {
  id: string;
  client_id: string;
  appointment_id: string | null;
  status: string;
  expires_at: string;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')?.trim() ?? '';
  if (!token) return NextResponse.json({ ok: false, error: 'This PAR-Q link is missing.' }, { status: 400 });

  try {
    const admin = createAdminClient();
    const invite = await getInvite(admin, token);
    if (!invite) return NextResponse.json({ ok: false, error: 'This PAR-Q link is invalid or has expired.' }, { status: 404 });
    if (invite.status === 'completed') {
      return NextResponse.json({ ok: false, error: 'This PAR-Q has already been completed.' }, { status: 410 });
    }

    const [{ data: client, error: clientError }, appointmentResult] = await Promise.all([
      admin.from('pt_clients').select('name, last_name, email, date_of_birth').eq('id', invite.client_id).single(),
      invite.appointment_id
        ? admin.from('pt_booking_appointments').select('id, start_at, end_at, location, status').eq('id', invite.appointment_id).single()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (clientError || !client) throw clientError ?? new Error('Client not found.');
    if (appointmentResult.error) throw appointmentResult.error;

    const nameParts = client.name.trim().split(/\s+/);
    const firstName = nameParts.shift() ?? client.name;
    const lastName = client.last_name || nameParts.join(' ');

    return NextResponse.json({
      ok: true,
      client: {
        first_name: firstName,
        last_name: lastName,
        email: client.email,
        date_of_birth: client.date_of_birth ?? '',
      },
      appointment: appointmentResult.data,
      already_booked: Boolean(appointmentResult.data),
    });
  } catch (error) {
    console.error('Load PAR-Q invite failed', error);
    return NextResponse.json({ ok: false, error: 'Could not open this PAR-Q link.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: SubmissionBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const token = cleanText(body.token, 200);
  const dateOfBirth = cleanText(body.date_of_birth, 10);
  const otherMedicalNote = cleanText(body.other_medical_note, 400);
  const coachNotes = cleanText(body.coach_notes, 1200);
  const signatureDataUrl = typeof body.signature_data_url === 'string' ? body.signature_data_url : '';

  if (!token) return NextResponse.json({ ok: false, error: 'This PAR-Q link is missing.' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) || Number.isNaN(new Date(dateOfBirth).getTime()) || new Date(dateOfBirth) >= new Date()) {
    return NextResponse.json({ ok: false, error: 'A valid date of birth is required.' }, { status: 400 });
  }
  if (!signatureDataUrl.startsWith('data:image/png;base64,') || signatureDataUrl.length > 600000) {
    return NextResponse.json({ ok: false, error: 'Signature is required.' }, { status: 400 });
  }
  if (!isAnswerRecord(body.answers)) {
    return NextResponse.json({ ok: false, error: 'Complete every PAR-Q question.' }, { status: 400 });
  }

  const answers: Record<string, ParQAnswer> = {};
  for (const question of PAR_Q_QUESTIONS) {
    const answer = body.answers[question.id];
    if (answer !== 'yes' && answer !== 'no') {
      return NextResponse.json({ ok: false, error: 'Complete every PAR-Q question.' }, { status: 400 });
    }
    answers[question.id] = answer;
  }

  try {
    const admin = createAdminClient();
    const invite = await getInvite(admin, token);
    if (!invite || invite.status !== 'pending') {
      return NextResponse.json({ ok: false, error: 'This PAR-Q link is invalid, expired, or already completed.' }, { status: 410 });
    }
    if (!invite.appointment_id) {
      return NextResponse.json({ ok: false, error: 'Choose an assessment time before submitting.' }, { status: 409 });
    }

    const [{ data: client, error: clientError }, { data: appointment, error: appointmentError }] = await Promise.all([
      admin.from('pt_clients').select('id, name, last_name, email').eq('id', invite.client_id).single(),
      admin.from('pt_booking_appointments').select('id, start_at, end_at, location').eq('id', invite.appointment_id).single(),
    ]);
    if (clientError || !client) throw clientError ?? new Error('Client not found.');
    if (appointmentError || !appointment) throw appointmentError ?? new Error('Appointment not found.');

    const submittedAt = new Date().toISOString();
    const medicalFlag = Object.values(answers).includes('yes');
    const parqAnswers = PAR_Q_QUESTIONS.map((question) => ({
      id: question.id,
      label: question.label,
      text: question.text,
      answer: answers[question.id],
    }));

    let parqPdfPath: string | null = null;
    try {
      const nameParts = client.name.trim().split(/\s+/);
      const firstName = nameParts.shift() ?? client.name;
      const lastName = client.last_name || nameParts.join(' ');
      const pdfBytes = await buildParqPdf({
        firstName,
        lastName,
        dateOfBirth,
        email: client.email,
        consentText: PAR_Q_CONSENT_TEXT,
        answers: parqAnswers.map((row) => ({ label: row.label, text: row.text, answer: row.answer })),
        otherMedicalNote,
        signatureDataUrl,
        appointmentStartAt: appointment.start_at,
        coachNotes,
        submittedAt,
      });
      const path = `${client.id}/parq/${Date.now()}-par-q.pdf`;
      const uploadRes = await admin.storage
        .from(PARQ_BUCKET)
        .upload(path, Buffer.from(pdfBytes), { contentType: 'application/pdf', upsert: true });
      if (!uploadRes.error) parqPdfPath = path;
      else console.error('PAR-Q PDF upload failed', uploadRes.error);
    } catch (pdfError) {
      console.error('PAR-Q PDF generation failed', pdfError);
    }

    const context = {
      source: 'movement_assessment_intake',
      submitted_at: submittedAt,
      appointment_id: appointment.id,
      appointment_start_at: appointment.start_at,
      appointment_end_at: appointment.end_at,
      session_minutes: MOVEMENT_ASSESSMENT_SESSION_MINUTES,
      first_name: client.name.trim().split(/\s+/)[0] || client.name,
      last_name: client.last_name || client.name.trim().split(/\s+/).slice(1).join(' '),
      date_of_birth: dateOfBirth,
      email: client.email,
      coach_notes: coachNotes,
      medical_flag: medicalFlag,
      consent_text: PAR_Q_CONSENT_TEXT,
      parq_answers: parqAnswers,
      other_medical_note: otherMedicalNote,
      signature_data_url: signatureDataUrl,
      parq_pdf_path: parqPdfPath,
    };

    const [noteRes, eventsRes, clientUpdateRes, inviteUpdateRes] = await Promise.all([
      admin.from('pt_client_notes').insert({
        client_id: client.id,
        content: `Movement assessment intake submitted. PAR-Q: ${medicalFlag ? 'medical flag present' : 'all No'}.${coachNotes ? ` Coach note: ${coachNotes}` : ''}`,
        is_active: true,
        context,
      }),
      admin.from('pt_events').insert({
        client_id: client.id,
        event_type: 'movement_assessment_intake_submitted',
        metadata: context,
      }),
      admin.from('pt_clients').update({
        date_of_birth: dateOfBirth,
        updated_at: submittedAt,
      }).eq('id', client.id),
      admin.from('pt_movement_assessment_invites').update({
        status: 'completed',
        completed_at: submittedAt,
        updated_at: submittedAt,
      }).eq('id', invite.id).eq('status', 'pending'),
    ]);
    if (noteRes.error) throw noteRes.error;
    if (eventsRes.error) throw eventsRes.error;
    if (clientUpdateRes.error) throw clientUpdateRes.error;
    if (inviteUpdateRes.error) throw inviteUpdateRes.error;

    try {
      await sendCoachParqNotification({
        clientName: client.name,
        clientEmail: client.email,
        appointmentStartAt: appointment.start_at,
        medicalFlag,
        coachNotes,
        siteOrigin: req.nextUrl.origin,
      });
    } catch (notificationError) {
      console.error('Coach PAR-Q notification failed', notificationError);
    }

    return NextResponse.json({ ok: true, appointment });
  } catch (error) {
    console.error('Submit invited PAR-Q failed', error);
    return NextResponse.json({ ok: false, error: 'Could not save the PAR-Q.' }, { status: 500 });
  }
}

async function getInvite(admin: ReturnType<typeof createAdminClient>, token: string) {
  const { data, error } = await admin
    .from('pt_movement_assessment_invites')
    .select('id, client_id, appointment_id, status, expires_at')
    .eq('token_hash', createHash('sha256').update(token).digest('hex'))
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return data as InviteRow | null;
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function isAnswerRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function sendCoachParqNotification(input: {
  clientName: string;
  clientEmail: string;
  appointmentStartAt: string;
  medicalFlag: boolean;
  coachNotes: string;
  siteOrigin: string;
}) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error('Coach PAR-Q notification skipped: RESEND_API_KEY is missing.');
    return false;
  }

  const coachEmail = process.env.COACH_NOTIFY_EMAIL ?? process.env.PEDRO_EMAIL ?? 'pedro@cerebroai.au';
  const when = `${formatBookingDate(input.appointmentStartAt)} at ${formatBookingTime(input.appointmentStartAt)}`;
  const mlUrl = `${input.siteOrigin.replace(/\/$/, '')}/dashboard/pt/ml-assessment`;
  const parqStatus = input.medicalFlag
    ? 'MEDICAL FLAG present. Review the answers before the session.'
    : 'All answers are No.';
  const subject = input.medicalFlag
    ? `[PAR-Q complete] ${input.clientName}: medical flag`
    : `[PAR-Q complete] ${input.clientName}`;
  const text = [
    `${input.clientName} has completed their PAR-Q.`,
    '',
    `Client: ${input.clientName} <${input.clientEmail}>`,
    `Movement assessment: ${when}`,
    `PAR-Q: ${parqStatus}`,
    input.coachNotes ? `Client note: ${input.coachNotes}` : null,
    '',
    `Open M&L: ${mlUrl}`,
    '',
    'The signed PAR-Q PDF is saved on the client profile.',
  ].filter((line): line is string => line !== null).join('\n');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_PEDRO_NOTIFY ?? 'Pedro Avila Coaching <pedro@cerebroai.au>',
      to: coachEmail,
      subject,
      text,
    }),
  });

  if (!response.ok) {
    console.error('Coach PAR-Q notification returned', response.status, await response.text());
  }
  return response.ok;
}
