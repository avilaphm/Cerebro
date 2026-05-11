import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';
import type { PTClient } from '@/utils/pt/types';

interface PTEvent {
  id: string;
  client_id: string;
  event_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
  pt_clients: { name: string } | null;
}

function formatEvent(e: PTEvent): string {
  const name = e.pt_clients?.name ?? 'Unknown';
  switch (e.event_type) {
    case 'programme_assigned':
      return `${name} was assigned "${String(e.metadata.template_name ?? 'a programme')}"`;
    case 'client_login':
      return `${name} logged in`;
    case 'password_set':
      return `${name} set their password`;
    case 'workout_completed':
      return `${name} completed a workout`;
    default:
      return `${name}: ${e.event_type.replace(/_/g, ' ')}`;
  }
}

export default async function PTOverviewPage() {
  const supabase = await createClient();

  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [clientRes, assignmentRes, workoutRes, eventRes] = await Promise.all([
    supabase.from('pt_clients').select('*').order('created_at', { ascending: false }),
    supabase.from('pt_program_assignments').select('client_id, status').eq('status', 'active'),
    supabase
      .from('pt_workout_logs')
      .select('client_id, workout_title, completed_at, pt_clients(name)')
      .order('completed_at', { ascending: false })
      .limit(50),
    supabase
      .from('pt_events')
      .select('*, pt_clients(name)')
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  const clients = (clientRes.data ?? []) as PTClient[];
  const activeAssignments = assignmentRes.data ?? [];
  const recentWorkouts = workoutRes.data ?? [];
  const events = (eventRes.data ?? []) as PTEvent[];

  const activeAssignedClientIds = new Set(activeAssignments.map((a) => a.client_id));
  const needsProgramming = clients.filter((c) => !activeAssignedClientIds.has(c.id));

  const recentWorkoutClientIds = new Set(
    recentWorkouts.filter((w) => w.completed_at > sevenDaysAgo).map((w) => w.client_id),
  );
  const workedOutThisWeek = clients.filter((c) => recentWorkoutClientIds.has(c.id));

  const workoutClientIds14 = new Set(
    recentWorkouts.filter((w) => w.completed_at > fourteenDaysAgo).map((w) => w.client_id),
  );
  const needsAttention = clients.filter(
    (c) => activeAssignedClientIds.has(c.id) && !workoutClientIds14.has(c.id),
  );

  const sessionLow = clients
    .filter((c) => c.sessions_remaining <= 3)
    .sort((a, b) => a.sessions_remaining - b.sessions_remaining);

  const seen = new Set<string>();
  const latestWorkoutPerClient = recentWorkouts.filter((w) => {
    if (seen.has(w.client_id)) return false;
    seen.add(w.client_id);
    return true;
  });

  return (
    <div className="p-8 max-w-5xl">
      <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-1">Dashboard</p>
      <h1 className="font-display text-3xl font-light tracking-[-0.02em] mb-8">Overview</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        {[
          { label: 'Clients', value: clients.length },
          { label: 'Active programmes', value: activeAssignments.length },
          { label: 'Worked out this week', value: workedOutThisWeek.length },
          { label: 'Needs attention', value: needsAttention.length, alert: needsAttention.length > 0 },
        ].map((s) => (
          <div key={s.label} className={`border p-5 ${s.alert ? 'border-amber-300 bg-amber-50' : 'border-black/10'}`}>
            <p className={`text-3xl font-light ${s.alert ? 'text-amber-700' : ''}`}>{s.value}</p>
            <p className={`text-xs mt-1 uppercase tracking-[0.12em] ${s.alert ? 'text-amber-600' : 'text-black/40'}`}>{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-8 mb-8">
        {needsAttention.length > 0 && (
          <section>
            <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-amber-600 mb-4">Needs attention (14 days no workout)</h2>
            <div className="space-y-2">
              {needsAttention.map((c) => {
                const lastWorkout = recentWorkouts.find((w) => w.client_id === c.id);
                return (
                  <Link
                    key={c.id}
                    href={`/dashboard/pt/clients/${c.id}`}
                    className="flex items-center justify-between border border-amber-200 bg-amber-50/50 px-4 py-3 hover:border-amber-400 transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-black/40">
                        {lastWorkout
                          ? `Last: ${new Date(lastWorkout.completed_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} — ${lastWorkout.workout_title}`
                          : 'No workouts logged'}
                      </p>
                    </div>
                    <span className="text-xs text-amber-600">Check in</span>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        <section>
          <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/40 mb-4">Recent workouts</h2>
          {latestWorkoutPerClient.length === 0 ? (
            <p className="text-sm text-black/30">No workouts logged yet.</p>
          ) : (
            <div className="space-y-2">
              {latestWorkoutPerClient.map((w) => {
                const clientData = w.pt_clients as unknown as { name: string } | null;
                const date = new Date(w.completed_at).toLocaleDateString('en-AU', {
                  day: 'numeric', month: 'short',
                });
                return (
                  <div key={w.client_id} className="flex items-center justify-between border border-black/8 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">{clientData?.name ?? 'Unknown'}</p>
                      <p className="text-xs text-black/40">{w.workout_title}</p>
                    </div>
                    <p className="text-xs text-black/30">{date}</p>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {sessionLow.length > 0 && (
          <section>
            <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/40 mb-4">Sessions running low</h2>
            <div className="space-y-2">
              {sessionLow.map((c) => (
                <Link
                  key={c.id}
                  href={`/dashboard/pt/clients/${c.id}`}
                  className="flex items-center justify-between border border-black/8 px-4 py-3 hover:border-black/20 transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-black/40">{c.email}</p>
                  </div>
                  <span className={`text-sm font-medium ${c.sessions_remaining === 0 ? 'text-red-500' : 'text-amber-600'}`}>
                    {c.sessions_remaining} left
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {needsProgramming.length > 0 && (
          <section>
            <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/40 mb-4">Needs programming</h2>
            <div className="space-y-2">
              {needsProgramming.map((c) => (
                <Link
                  key={c.id}
                  href={`/dashboard/pt/clients/${c.id}`}
                  className="flex items-center justify-between border border-black/8 px-4 py-3 hover:border-black/20 transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-black/40">{c.email}</p>
                  </div>
                  <span className="text-xs border border-black/15 px-3 py-1 text-black/40">
                    Assign
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      <section>
        <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/40 mb-4">Recent activity</h2>
        {events.length === 0 ? (
          <p className="text-sm text-black/30">No activity yet.</p>
        ) : (
          <div className="space-y-1">
            {events.map((e) => {
              const date = new Date(e.created_at).toLocaleDateString('en-AU', {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
              });
              return (
                <div key={e.id} className="flex items-center justify-between border-b border-black/5 py-2.5">
                  <p className="text-sm text-black/70">{formatEvent(e)}</p>
                  <p className="text-xs text-black/30 shrink-0 ml-4">{date}</p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
