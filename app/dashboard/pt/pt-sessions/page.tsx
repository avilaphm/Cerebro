import { createClient } from '@/utils/supabase/server';
import { fetchAllPTExercises } from '@/utils/pt/exercise-library';
import type { PTClient, PTExercise } from '@/utils/pt/types';
import type { PTBookingAppointment } from '@/utils/pt/bookings';
import PTSessionsView from './PTSessionsView';

export default async function PTSessionsPage() {
  const supabase = await createClient();

  // Start from beginning of today so past-but-not-completed appointments still show
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [clientRes, exerciseRes, appointmentRes] = await Promise.all([
    supabase
      .from('pt_clients')
      .select('*')
      .in('status', ['invited', 'active'])
      .order('name', { ascending: true }),
    fetchAllPTExercises(supabase),
    supabase
      .from('pt_booking_appointments')
      .select('*, pt_clients(id, name, email, sessions_remaining)')
      .in('status', ['scheduled', 'confirmed'])
      .gte('start_at', todayStart.toISOString())
      .order('start_at', { ascending: true })
      .limit(10),
  ]);

  const clients = (clientRes.data ?? []) as PTClient[];
  const exercises = exerciseRes as PTExercise[];
  const appointments = (appointmentRes.data ?? []) as PTBookingAppointment[];

  return (
    <PTSessionsView
      initialClients={clients}
      exercises={exercises}
      initialAppointments={appointments}
    />
  );
}
