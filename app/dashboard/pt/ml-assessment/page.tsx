import { createClient } from '@/utils/supabase/server';
import type { PTClient } from '@/utils/pt/types';
import MLAssessmentView, { type MLAssessmentIntakeNote, type MLAssessmentAppointment } from './MLAssessmentView';

export default async function MLAssessmentPage() {
  const supabase = await createClient();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [clientRes, noteRes, appointmentRes] = await Promise.all([
    supabase
      .from('pt_clients')
      .select('*')
      .in('status', ['invited', 'active'])
      .order('name', { ascending: true }),
    supabase
      .from('pt_client_notes')
      .select('id, client_id, content, created_at, context')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(250),
    supabase
      .from('pt_booking_appointments')
      .select('id, client_id, start_at, end_at, status, notes, pt_clients(id, name, email)')
      .in('status', ['scheduled', 'confirmed'])
      .gte('start_at', todayStart.toISOString())
      .order('start_at', { ascending: true })
      .limit(60),
  ]);

  const clients = (clientRes.data ?? []) as PTClient[];
  const intakeNotes = ((noteRes.data ?? []) as MLAssessmentIntakeNote[]).filter((note) => {
    const context = note.context ?? {};
    return context.source === 'movement_assessment_intake';
  });
  const appointments = ((appointmentRes.data ?? []) as unknown[]).map((row) => {
    const appointment = row as Omit<MLAssessmentAppointment, 'pt_clients'> & {
      pt_clients?: MLAssessmentAppointment['pt_clients'] | MLAssessmentAppointment['pt_clients'][];
    };
    return {
      ...appointment,
      pt_clients: Array.isArray(appointment.pt_clients) ? appointment.pt_clients[0] ?? null : appointment.pt_clients ?? null,
    };
  }).filter((appointment) =>
    (appointment.notes ?? '').toLowerCase().includes('movement assessment'),
  );

  return (
    <MLAssessmentView
      clients={clients}
      intakeNotes={intakeNotes}
      appointments={appointments}
    />
  );
}
