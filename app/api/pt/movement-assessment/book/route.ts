import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { PTBookingAvailability, PTBookingBlock } from '@/utils/pt/bookings';
import {
  assessmentBlockEnd,
  findMovementAssessmentSlot,
  MOVEMENT_ASSESSMENT_SESSION_MINUTES,
} from '@/utils/pt/movement-assessment-booking';
import { PAR_Q_CONSENT_TEXT, PAR_Q_QUESTIONS, type ParQAnswer } from '@/utils/pt/parq';
import { buildParqPdf } from '@/utils/pt/parq-pdf';
import { formatBookingDate, formatBookingTime } from '@/utils/pt/bookings';
import { createAdminClient } from '@/utils/supabase/admin';

export const dynamic = 'force-dynamic';

const PARQ_BUCKET = 'pt-client-docs';

interface BookAssessmentBody {
  first_name?: unknown;
  last_name?: unknown;
  date_of_birth?: unknown;
  email?: unknown;
  answers?: unknown;
  other_medical_note?: unknown;
  signature_data_url?: unknown;
  coach_notes?: unknown;
  start_at?: unknown;
  invite_token?: unknown;
}

interface ClientRow {
  id: string;
  name: string;
  last_name: string | null;
  date_of_birth: string | null;
  email: string;
  status: string;
  notes: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  let body: BookAssessmentBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const parsed = parseBody(body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  try {
    const supabase = createAdminClient();
    const now = new Date();
    const rangeEnd = new Date(now.getTime() + 29 * 24 * 60 * 60 * 1000).toISOString();

    const [availabilityRes, blocksRes] = await Promise.all([
      supabase.from('pt_booking_availability').select('*').eq('is_active', true),
      supabase
        .from('pt_booking_blocks')
        .select('start_at, end_at, status')
        .eq('status', 'active')
        .lt('start_at', rangeEnd)
        .gt('end_at', now.toISOString()),
    ]);

    if (availabilityRes.error) throw availabilityRes.error;
    if (blocksRes.error) throw blocksRes.error;

    const availability = (availabilityRes.data ?? []) as PTBookingAvailability[];
    const slot = findMovementAssessmentSlot(
      parsed.data.start_at,
      availability,
      (blocksRes.data ?? []) as Pick<PTBookingBlock, 'start_at' | 'end_at' | 'status'>[],
      now,
    );

    if (!slot) {
      return NextResponse.json({ ok: false, error: 'That time is no longer available. Choose another time.' }, { status: 409 });
    }

    const availabilityWindow = availability.find((window) => window.id === slot.availability_id);
    if (!availabilityWindow) {
      return NextResponse.json({ ok: false, error: 'That time is no longer available. Choose another time.' }, { status: 409 });
    }

    const client = await findOrCreateClient(supabase, parsed.data.first_name, parsed.data.last_name, parsed.data.email, parsed.data.date_of_birth);
    const invite = parsed.data.invite_token
      ? await findPendingInvite(supabase, parsed.data.invite_token, client.id)
      : null;
    if (parsed.data.invite_token && !invite) {
      return NextResponse.json({ ok: false, error: 'This PAR-Q link is invalid or has expired.' }, { status: 410 });
    }
    const medicalFlag = Object.values(parsed.data.answers).includes('yes');
    const submittedAt = new Date().toISOString();
    const parqAnswers = PAR_Q_QUESTIONS.map((question) => ({
      id: question.id,
      label: question.label,
      text: question.text,
      answer: parsed.data.answers[question.id],
    }));

    const appointmentNote = [
      'Movement Assessment booking from public intake.',
      'Client has been told to bring comfortable clothes.',
      parsed.data.coach_notes ? `Coach note: ${parsed.data.coach_notes}` : null,
    ].filter(Boolean).join('\n');

    const appointmentRes = await supabase
      .from('pt_booking_appointments')
      .insert({
        client_id: client.id,
        start_at: slot.start_at,
        end_at: slot.end_at,
        timezone: 'Australia/Sydney',
        status: 'confirmed',
        source: 'client',
        location: slot.location,
        notes: appointmentNote,
        confirmed_at: submittedAt,
        created_by: null,
      })
      .select('id, start_at, end_at, location')
      .single();

    if (appointmentRes.error || !appointmentRes.data) throw appointmentRes.error ?? new Error('Could not create booking.');

    await supabase.from('pt_booking_blocks').insert({
      appointment_id: appointmentRes.data.id,
      start_at: slot.start_at,
      end_at: assessmentBlockEnd(slot.end_at, availabilityWindow),
      status: 'active',
    });

    // Generate the signed PAR-Q as a PDF and store it on the client profile.
    let parqPdfPath: string | null = null;
    try {
      const pdfBytes = await buildParqPdf({
        firstName: parsed.data.first_name,
        lastName: parsed.data.last_name,
        dateOfBirth: parsed.data.date_of_birth,
        email: parsed.data.email,
        consentText: PAR_Q_CONSENT_TEXT,
        answers: parqAnswers.map((row) => ({ label: row.label, text: row.text, answer: row.answer })),
        otherMedicalNote: parsed.data.other_medical_note,
        signatureDataUrl: parsed.data.signature_data_url,
        appointmentStartAt: slot.start_at,
        coachNotes: parsed.data.coach_notes,
        submittedAt,
      });
      const path = `${client.id}/parq/${Date.now()}-par-q.pdf`;
      const uploadRes = await supabase.storage
        .from(PARQ_BUCKET)
        .upload(path, Buffer.from(pdfBytes), { contentType: 'application/pdf', upsert: true });
      if (uploadRes.error) {
        console.error('PAR-Q PDF upload failed', uploadRes.error);
      } else {
        parqPdfPath = path;
      }
    } catch (pdfError) {
      console.error('PAR-Q PDF generation failed', pdfError);
    }

    const context = {
      source: 'movement_assessment_intake',
      submitted_at: submittedAt,
      appointment_id: appointmentRes.data.id,
      appointment_start_at: slot.start_at,
      appointment_end_at: slot.end_at,
      session_minutes: MOVEMENT_ASSESSMENT_SESSION_MINUTES,
      first_name: parsed.data.first_name,
      last_name: parsed.data.last_name,
      date_of_birth: parsed.data.date_of_birth,
      email: parsed.data.email,
      coach_notes: parsed.data.coach_notes,
      medical_flag: medicalFlag,
      consent_text: PAR_Q_CONSENT_TEXT,
      parq_answers: parqAnswers,
      other_medical_note: parsed.data.other_medical_note,
      signature_data_url: parsed.data.signature_data_url,
      parq_pdf_path: parqPdfPath,
    };

    await Promise.all([
      supabase.from('pt_client_notes').insert({
        client_id: client.id,
        content: `Movement assessment intake submitted. PAR-Q: ${medicalFlag ? 'medical flag present' : 'all No'}.${parsed.data.coach_notes ? ` Coach note: ${parsed.data.coach_notes}` : ''}`,
        is_active: true,
        context,
      }),
      supabase.from('pt_events').insert([
        {
          client_id: client.id,
          event_type: 'movement_assessment_intake_submitted',
          metadata: context,
        },
        {
          client_id: client.id,
          event_type: 'session_booked',
          metadata: {
            source: 'movement_assessment_public',
            appointment_id: appointmentRes.data.id,
            first_start_at: slot.start_at,
            session_minutes: MOVEMENT_ASSESSMENT_SESSION_MINUTES,
          },
        },
      ]),
      invite
        ? supabase
            .from('pt_movement_assessment_invites')
            .update({
              appointment_id: appointmentRes.data.id,
              status: 'completed',
              completed_at: submittedAt,
              updated_at: submittedAt,
            })
            .eq('id', invite.id)
            .eq('status', 'pending')
        : Promise.resolve({ error: null }),
    ]);

    try {
      await syncAssessmentCalendar(appointmentRes.data.id);
    } catch (calendarError) {
      console.error('Movement assessment calendar sync failed', calendarError);
    }

    try {
      await sendAssessmentEmails({
        clientName: parsed.data.first_name,
        clientEmail: parsed.data.email,
        startAt: slot.start_at,
        location: slot.location,
        medicalFlag,
        coachNotes: parsed.data.coach_notes,
      });
    } catch (emailError) {
      console.error('Movement assessment confirmation email failed', emailError);
    }

    return NextResponse.json({
      ok: true,
      client_id: client.id,
      appointment: appointmentRes.data,
    });
  } catch (error) {
    console.error('Movement assessment booking failed', error);
    return NextResponse.json({ ok: false, error: 'Could not complete the booking.' }, { status: 500 });
  }
}

function parseBody(body: BookAssessmentBody):
  | { ok: true; data: { first_name: string; last_name: string; date_of_birth: string; email: string; answers: Record<string, ParQAnswer>; other_medical_note: string; signature_data_url: string; coach_notes: string; start_at: string; invite_token: string } }
  | { ok: false; error: string } {
  const firstName = cleanText(body.first_name, 80);
  const lastName = cleanText(body.last_name, 80);
  const dateOfBirth = cleanText(body.date_of_birth, 10);
  const email = cleanText(body.email, 160).toLowerCase();
  const startAt = cleanText(body.start_at, 80);
  const coachNotes = cleanText(body.coach_notes, 1200);
  const otherMedicalNote = cleanText(body.other_medical_note, 400);
  const signatureDataUrl = typeof body.signature_data_url === 'string' ? body.signature_data_url : '';
  const inviteToken = cleanText(body.invite_token, 200);

  if (!firstName || !lastName) return { ok: false, error: 'First and last name are required.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) || Number.isNaN(new Date(dateOfBirth).getTime()) || new Date(dateOfBirth) >= new Date()) {
    return { ok: false, error: 'A valid date of birth is required.' };
  }
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'A valid email address is required.' };
  if (!startAt || Number.isNaN(new Date(startAt).getTime())) return { ok: false, error: 'Choose an available time.' };
  if (!signatureDataUrl.startsWith('data:image/png;base64,') || signatureDataUrl.length > 600000) {
    return { ok: false, error: 'Signature is required.' };
  }

  if (!isAnswerRecord(body.answers)) return { ok: false, error: 'Complete every PAR-Q question.' };

  const answers: Record<string, ParQAnswer> = {};
  for (const question of PAR_Q_QUESTIONS) {
    const answer = body.answers[question.id];
    if (answer !== 'yes' && answer !== 'no') return { ok: false, error: 'Complete every PAR-Q question.' };
    answers[question.id] = answer;
  }

  return {
    ok: true,
    data: {
      first_name: firstName,
      last_name: lastName,
      date_of_birth: dateOfBirth,
      email,
      answers,
      other_medical_note: otherMedicalNote,
      signature_data_url: signatureDataUrl,
      coach_notes: coachNotes,
      start_at: new Date(startAt).toISOString(),
      invite_token: inviteToken,
    },
  };
}

async function findPendingInvite(
  supabase: ReturnType<typeof createAdminClient>,
  token: string,
  clientId: string,
) {
  const { data, error } = await supabase
    .from('pt_movement_assessment_invites')
    .select('id')
    .eq('token_hash', createHash('sha256').update(token).digest('hex'))
    .eq('client_id', clientId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return data as { id: string } | null;
}

function isAnswerRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

async function findOrCreateClient(
  supabase: ReturnType<typeof createAdminClient>,
  firstName: string,
  lastName: string,
  email: string,
  dateOfBirth: string,
): Promise<ClientRow> {
  const fullName = `${firstName} ${lastName}`.trim();
  const existingRes = await supabase
    .from('pt_clients')
    .select('id, name, last_name, date_of_birth, email, status, notes')
    .ilike('email', email)
    .maybeSingle();

  if (existingRes.error) throw existingRes.error;
  if (existingRes.data) {
    const existing = existingRes.data as ClientRow;
    const date_of_birth = existing.date_of_birth || dateOfBirth;
    await supabase
      .from('pt_clients')
      .update({
        name: existing.name || fullName,
        last_name: existing.last_name || lastName,
        date_of_birth,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    return { ...existing, name: existing.name || fullName, last_name: existing.last_name || lastName, date_of_birth };
  }

  const insertedRes = await supabase
    .from('pt_clients')
    .insert({
      name: fullName,
      last_name: lastName,
      date_of_birth: dateOfBirth,
      email,
      status: 'invited',
      sessions_remaining: 0,
      notes: 'Created from public Movement Assessment intake.',
    })
    .select('id, name, last_name, date_of_birth, email, status, notes')
    .single();

  if (insertedRes.error || !insertedRes.data) throw insertedRes.error ?? new Error('Could not create client.');
  return insertedRes.data as ClientRow;
}

async function syncAssessmentCalendar(appointmentId: string) {
  const secret = process.env.ASSESSMENT_CAL_SYNC_SECRET;
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!secret || !baseUrl) return;

  const res = await fetch(`${baseUrl}/functions/v1/sync-assessment-calendar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ appointment_id: appointmentId }),
  });
  if (!res.ok) {
    console.error('sync-assessment-calendar returned', res.status, await res.text());
  }
}

async function sendAssessmentEmails(input: {
  clientName: string;
  clientEmail: string;
  startAt: string;
  location: string | null;
  medicalFlag: boolean;
  coachNotes: string;
}) {
  const when = `${formatBookingDate(input.startAt)} · ${formatBookingTime(input.startAt)}`;
  const locationLine = input.location ? `\nLocation: ${input.location}` : '';

  const clientSubject = 'Your movement assessment is booked';
  const clientText = `Hi ${input.clientName},\n\nThank you, your movement assessment with Pedro is booked.\n\nWhen: ${when}${locationLine}\n\nBring comfortable clothes you can move in. We'll have a short chat first, then go through the movement assessment.\n\nSee you then,\nPedro Avila`;
  await sendEmail(input.clientEmail, clientSubject, clientText);

  const coachEmail = process.env.COACH_NOTIFY_EMAIL ?? process.env.PEDRO_EMAIL ?? 'pedro@cerebroai.au';
  const coachSubject = `[Movement Assessment] ${input.clientName}: ${when}`;
  const coachText = `New movement assessment booked from the public intake.\n\nClient: ${input.clientName} <${input.clientEmail}>\nWhen: ${when}${locationLine}\nPAR-Q: ${input.medicalFlag ? 'MEDICAL FLAG present. Review before training.' : 'all answers No'}${input.coachNotes ? `\nClient note: ${input.coachNotes}` : ''}\n\nThe signed PAR-Q PDF is saved on the client profile.`;
  await sendEmail(coachEmail, coachSubject, coachText);
}

async function sendEmail(to: string, subject: string, text: string) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_PEDRO_NOTIFY ?? 'Pedro Avila Coaching <pedro@cerebroai.au>',
      to,
      subject,
      text,
    }),
  });
}
