import { createClient } from '@/utils/supabase/server';
import type { PTClient } from '@/utils/pt/types';

export default async function PTOverviewPage() {
  const supabase = await createClient();

  const [clientRes, assignmentRes, workoutRes] = await Promise.all([
    supabase.from('pt_clients').select('*').order('created_at', { ascending: false }),
    supabase.from('pt_program_assignments').select('client_id, status').eq('status', 'active'),
    supabase
      .from('pt_workout_logs')
      .select('client_id, workout_title, completed_at, pt_clients(name)')
      .order('completed_at', { ascending: false })
      .limit(30),
  ]);

  const clients = (clientRes.data ?? []) as PTClient[];
  const activeAssignments = assignmentRes.data ?? [];
  const recentWorkouts = workoutRes.data ?? [];

  const activeAssignedClientIds = new Set(activeAssignments.map((a) => a.client_id));
  const workedOutClientIds = new Set(recentWorkouts.map((w) => w.client_id));
  const needsProgramming = clients.filter((c) => !activeAssignedClientIds.has(c.id));

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentWorkoutClientIds = new Set(
    recentWorkouts.filter((w) => w.completed_at > sevenDaysAgo).map((w) => w.client_id)
  );
  const workedOutThisWeek = clients.filter((c) => recentWorkoutClientIds.has(c.id));

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
          { label: 'Needs programming', value: needsProgramming.length },
        ].map((s) => (
          <div key={s.label} className="border border-black/10 p-5">
            <p className="text-3xl font-light">{s.value}</p>
            <p className="text-xs text-black/40 mt-1 uppercase tracking-[0.12em]">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-8">
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

        <section>
          <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/40 mb-4">Sessions remaining</h2>
          {sessionLow.length === 0 ? (
            <p className="text-sm text-black/30">All clients have sessions remaining.</p>
          ) : (
            <div className="space-y-2">
              {sessionLow.map((c) => (
                <div key={c.id} className="flex items-center justify-between border border-black/8 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-black/40">{c.email}</p>
                  </div>
                  <span className={`text-sm font-medium ${c.sessions_remaining === 0 ? 'text-red-500' : 'text-amber-600'}`}>
                    {c.sessions_remaining} left
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {needsProgramming.length > 0 && (
          <section>
            <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/40 mb-4">Needs programming</h2>
            <div className="space-y-2">
              {needsProgramming.map((c) => (
                <div key={c.id} className="flex items-center justify-between border border-black/8 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-black/40">{c.email}</p>
                  </div>
                  <a
                    href={`/dashboard/pt/programmes`}
                    className="text-xs border border-black/20 px-3 py-1 hover:bg-black hover:text-white transition-colors"
                  >
                    Create
                  </a>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
