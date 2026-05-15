import { createClient } from '@/utils/supabase/server';
import type { PTClient, PTExercise } from '@/utils/pt/types';
import type { PTBookingAppointment } from '@/utils/pt/bookings';
import PTSessionsView from './PTSessionsView';

export default async function PTSessionsPage() {
  const supabase = await createClient();

  const [clientRes, exerciseRes, appointmentRes] = await Promise.all([
    supabase
      .from('pt_clients')
      .select('*')
      .eq('status', 'active')
      .order('name', { ascending: true }),
    supabase
      .from('pt_exercises')
      .select('*')
      .order('name', { ascending: true }),
    supabase
      .from('pt_booking_appointments')
      .select('*, pt_clients(id, name, email, sessions_remaining)')
      .in('status', ['scheduled', 'confirmed'])
      .gt('start_at', new Date().toISOString())
      .order('start_at', { ascending: true })
      .limit(1),
  ]);

  const clients = (clientRes.data ?? []) as PTClient[];
  const exercises = (exerciseRes.data ?? []) as PTExercise[];
  const nextAppointment = ((appointmentRes.data ?? []) as PTBookingAppointment[])[0] ?? null;

  return (
    <PTSessionsView
      initialClients={clients}
      exercises={exercises}
      nextAppointment={nextAppointment}
    />
  );
}
