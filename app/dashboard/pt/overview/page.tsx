import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';
import type { PTClient, PTClientMetric, PTWeeklyCheckin, PTWeeklyPlan } from '@/utils/pt/types';
import ClientWeeklyOverview, {
  type OverviewNutritionDoc,
  type OverviewNutritionLog,
  type OverviewWorkoutLog,
} from './ClientWeeklyOverview';
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

function weekStartInputValue(date = new Date()) {
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  const year = next.getFullYear();
  const month = String(next.getMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(next.getDate()).padStart(2, '0');
  return `${year}-${month}-${dayOfMonth}`;
}

export default async function PTOverviewPage() {
  const supabase = await createClient();

  // Keep every overview query on the same server-render snapshot.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const trackingQueryStart = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();
  const currentWeekStart = weekStartInputValue(new Date(now));

  const [clientRes, assignmentRes, workoutRes, eventRes, unreadRes, checkinRes, planRes, coachingTaskRes, metricRes, trackingNutritionRes, nutritionDocRes, trackingWorkoutRes] = await Promise.all([
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
    supabase
      .from('pt_messages')
      .select('client_id, content, created_at', { count: 'exact' })
      .eq('sender', 'client')
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('pt_weekly_checkins')
      .select('*')
      .eq('status', 'submitted')
      .order('created_at', { ascending: false }),
    supabase
      .from('pt_weekly_plans')
      .select('*')
      .eq('week_start', currentWeekStart),
    supabase
      .from('pt_coaching_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open'),
    supabase
      .from('pt_client_metrics')
      .select('*')
      .order('measured_at', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('pt_nutrition_logs')
      .select('client_id, logged_at, protein_g, calories')
      .gte('logged_at', trackingQueryStart),
    supabase
      .from('pt_client_nutrition_doc')
      .select('client_id, daily_targets'),
    supabase
      .from('pt_workout_logs')
      .select('client_id, workout_title, completed_at')
      .gte('completed_at', trackingQueryStart)
      .order('completed_at', { ascending: false }),
  ]);

  const clients = (clientRes.data ?? []) as PTClient[];
  const activeAssignments = assignmentRes.data ?? [];
  const recentWorkouts = workoutRes.data ?? [];
  const events = (eventRes.data ?? []) as PTEvent[];
  const unreadMessages = unreadRes.count ?? 0;
  const unreadMsgRows = (unreadRes.data ?? []) as { client_id: string; content: string; created_at: string }[];
  const seenUnreadClients = new Set<string>();
  const unreadNotifications = unreadMsgRows
    .filter((m) => {
      if (seenUnreadClients.has(m.client_id)) return false;
      seenUnreadClients.add(m.client_id);
      return true;
    })
    .map((m) => ({
      client_id: m.client_id,
      content: m.content,
      created_at: m.created_at,
      clientName: clients.find((c) => c.id === m.client_id)?.name ?? 'Client',
    }));
  const waitingCheckins = (checkinRes.data ?? []) as PTWeeklyCheckin[];
  const currentPlans = (planRes.data ?? []) as PTWeeklyPlan[];
  const openCoachingTasks = coachingTaskRes.count ?? 0;
  const metrics = (metricRes.data ?? []) as PTClientMetric[];
  const trackingNutritionLogs = (trackingNutritionRes.data ?? []) as OverviewNutritionLog[];
  const nutritionDocs = (nutritionDocRes.data ?? []) as OverviewNutritionDoc[];
  const trackingWorkoutLogs = (trackingWorkoutRes.data ?? []) as OverviewWorkoutLog[];

  const activeAssignedClientIds = new Set(activeAssignments.map((a) => a.client_id));
  const needsProgramming = clients.filter((c) => !activeAssignedClientIds.has(c.id));
  const activeClients = clients.filter((c) => c.status !== 'archived');
  const publishedPlanClientIds = new Set(currentPlans.filter((plan) => plan.status === 'published').map((plan) => plan.client_id));
  const draftPlanClientIds = new Set(currentPlans.filter((plan) => plan.status === 'draft').map((plan) => plan.client_id));
  const plansNotPublished = activeClients.filter((c) => !publishedPlanClientIds.has(c.id));
  const noPlanThisWeek = activeClients.filter((c) => !publishedPlanClientIds.has(c.id) && !draftPlanClientIds.has(c.id));
  const latestMetricByClient = new Map<string, PTClientMetric>();
  metrics.forEach((metric) => {
    if (!latestMetricByClient.has(metric.client_id)) latestMetricByClient.set(metric.client_id, metric);
  });
  const metricDueCutoff = fourteenDaysAgo.slice(0, 10);
  const metricsDue = activeClients.filter((c) => {
    const metric = latestMetricByClient.get(c.id);
    return !metric || metric.measured_at < metricDueCutoff;
  });

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
    <div className="max-w-5xl px-5 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-1">Dashboard</p>
      <h1 className="mb-8 font-display text-3xl font-light tracking-[-0.02em] sm:mb-10">Overview</h1>

      <div className="mb-10 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 xl:gap-4 xl:mb-12">
        {[
          { label: 'Clients', value: clients.length },
          { label: 'Active programmes', value: activeAssignments.length },
          { label: 'Worked out this week', value: workedOutThisWeek.length },
          { label: 'Needs attention', value: needsAttention.length, alert: needsAttention.length > 0 },
          { label: 'Unread messages', value: unreadMessages, alert: unreadMessages > 0, href: '/dashboard/pt/messages' },
        ].map((s) => (
          s.href ? (
            <Link key={s.label} href={s.href} className={`border p-5 transition-colors hover:border-black/30 sm:p-6 ${s.alert ? 'border-amber-300 bg-amber-50' : 'border-black/10'}`}>
              <p className={`text-3xl font-light ${s.alert ? 'text-amber-700' : ''}`}>{s.value}</p>
              <p className={`text-xs mt-2 uppercase tracking-[0.12em] ${s.alert ? 'text-amber-600' : 'text-black/40'}`}>{s.label}</p>
            </Link>
          ) : (
            <div key={s.label} className={`border p-5 sm:p-6 ${s.alert ? 'border-amber-300 bg-amber-50' : 'border-black/10'}`}>
              <p className={`text-3xl font-light ${s.alert ? 'text-amber-700' : ''}`}>{s.value}</p>
              <p className={`text-xs mt-2 uppercase tracking-[0.12em] ${s.alert ? 'text-amber-600' : 'text-black/40'}`}>{s.label}</p>
            </div>
          )
        ))}
      </div>

      {unreadNotifications.length > 0 && (
        <section className="mb-8">
          <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/40 mb-3">New messages</h2>
          <div className="space-y-2">
            {unreadNotifications.map((n) => (
              <Link
                key={n.client_id}
                href={`/dashboard/pt/messages?client=${n.client_id}`}
                className="flex items-center gap-4 border border-black/10 bg-white px-4 py-3.5 transition-colors hover:border-black/30"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-black shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">New message from {n.clientName}</p>
                  <p className="text-xs text-black/40 truncate mt-0.5">{n.content}</p>
                </div>
                <span className="text-xs text-black/30 shrink-0">
                  {new Date(n.created_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <ClientWeeklyOverview
        clients={clients}
        nutritionLogs={trackingNutritionLogs}
        nutritionDocs={nutritionDocs}
        workoutLogs={trackingWorkoutLogs}
      />

      <section className="mb-12">
        <div className="mb-5 flex items-end justify-between gap-3">
          <div>
            <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Coaching operations</p>
            <h2 className="mt-1 text-lg font-medium">Week of {new Date(`${currentWeekStart}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</h2>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 xl:gap-4">
          {[
            { label: 'Resets waiting', value: waitingCheckins.length, alert: waitingCheckins.length > 0 },
            { label: 'Plans not published', value: plansNotPublished.length, alert: plansNotPublished.length > 0 },
            { label: 'No plan this week', value: noPlanThisWeek.length, alert: noPlanThisWeek.length > 0 },
            { label: 'Open loops', value: openCoachingTasks, alert: openCoachingTasks > 0 },
            { label: 'Metrics due', value: metricsDue.length, alert: metricsDue.length > 0 },
          ].map((item) => (
            <div key={item.label} className={`border p-5 sm:p-6 ${item.alert ? 'border-amber-300 bg-amber-50' : 'border-black/10 bg-white'}`}>
              <p className={`text-2xl font-light ${item.alert ? 'text-amber-700' : 'text-black'}`}>{item.value}</p>
              <p className={`mt-2 text-[0.6rem] uppercase tracking-[0.12em] ${item.alert ? 'text-amber-700' : 'text-black/35'}`}>{item.label}</p>
            </div>
          ))}
        </div>

        {(waitingCheckins.length > 0 || plansNotPublished.length > 0) && (
          <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:gap-8">
            {waitingCheckins.length > 0 && (
              <div>
                <h3 className="mb-3 text-[0.6rem] uppercase tracking-[0.18em] text-amber-600">Reset review</h3>
                <div className="space-y-2">
                  {waitingCheckins.slice(0, 5).map((checkin) => {
                    const client = clients.find((c) => c.id === checkin.client_id);
                    return (
                      <Link key={checkin.id} href={`/dashboard/pt/clients/${checkin.client_id}`} className="block border border-amber-200 bg-amber-50/60 px-4 py-3.5 transition-colors hover:border-amber-400">
                        <p className="text-sm font-medium">{client?.name ?? 'Client'}</p>
                        <p className="mt-1 line-clamp-1 text-xs text-black/45">{checkin.client_focus || checkin.availability || 'Weekly reset submitted.'}</p>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
            {plansNotPublished.length > 0 && (
              <div>
                <h3 className="mb-3 text-[0.6rem] uppercase tracking-[0.18em] text-black/40">Planning queue</h3>
                <div className="space-y-2">
                  {plansNotPublished.slice(0, 5).map((client) => (
                    <Link key={client.id} href={`/dashboard/pt/clients/${client.id}`} className="flex flex-col gap-2 border border-black/8 px-4 py-3.5 transition-colors hover:border-black/25 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-medium">{client.name}</p>
                        <p className="text-xs text-black/40">{draftPlanClientIds.has(client.id) ? 'Draft waiting to publish' : 'No plan created'}</p>
                      </div>
                      <span className="text-xs text-black/35">Plan</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <div className="mb-10 grid gap-8 lg:grid-cols-2 lg:gap-10">
        {needsAttention.length > 0 && (
          <section>
            <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-amber-600 mb-4">Needs attention — 14 days no workout</h2>
            <div className="space-y-2">
              {needsAttention.map((c) => {
                const lastWorkout = recentWorkouts.find((w) => w.client_id === c.id);
                return (
                  <Link
                    key={c.id}
                    href={`/dashboard/pt/clients/${c.id}`}
                    className="flex flex-col gap-2 border border-amber-200 bg-amber-50/50 px-4 py-4 transition-colors hover:border-amber-400 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-black/40">
                        {lastWorkout
                          ? `Last: ${new Date(lastWorkout.completed_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} — ${lastWorkout.workout_title}`
                          : 'No workouts logged'}
                      </p>
                    </div>
                    <span className="text-xs text-amber-600 shrink-0">Check in</span>
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
                  <div key={w.client_id} className="flex flex-col gap-2 border border-black/8 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium">{clientData?.name ?? 'Unknown'}</p>
                      <p className="text-xs text-black/40">{w.workout_title}</p>
                    </div>
                    <p className="text-xs text-black/30 shrink-0">{date}</p>
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
                  className="flex flex-col gap-2 border border-black/8 px-4 py-4 transition-colors hover:border-black/20 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-black/40">{c.email}</p>
                  </div>
                  <span className={`text-sm font-medium shrink-0 ${c.sessions_remaining === 0 ? 'text-red-500' : 'text-amber-600'}`}>
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
                  className="flex flex-col gap-2 border border-black/8 px-4 py-4 transition-colors hover:border-black/20 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-black/40">{c.email}</p>
                  </div>
                  <span className="text-xs border border-black/15 px-3 py-1 text-black/40 shrink-0">
                    Assign
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      <section className="pb-8">
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
                <div key={e.id} className="flex flex-col gap-1 border-b border-black/5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-black/70">{formatEvent(e)}</p>
                  <p className="shrink-0 text-xs text-black/30 sm:ml-4">{date}</p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
