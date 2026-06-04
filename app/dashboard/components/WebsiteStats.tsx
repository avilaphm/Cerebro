import { createClient } from '@/utils/supabase/server';

interface VisitRow {
  session_id: string | null;
  source: string | null;
  duration_seconds: number | null;
  path: string;
}

interface EventRow {
  session_id: string | null;
  event_type: string;
  source: string | null;
}

const SOURCE_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  x: 'X',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  search: 'Search',
  direct: 'Direct',
};

function label(source: string) {
  return SOURCE_LABELS[source] ?? source;
}

function fmtDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default async function WebsiteStats() {
  const supabase = await createClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [visitsRes, eventsRes] = await Promise.all([
    supabase
      .from('page_visits')
      .select('session_id, source, duration_seconds, path')
      .gte('created_at', sevenDaysAgo)
      .eq('path', '/')
      .limit(5000),
    supabase
      .from('site_events')
      .select('session_id, event_type, source')
      .gte('created_at', sevenDaysAgo)
      .limit(5000),
  ]);

  const visits = (visitsRes.data ?? []) as VisitRow[];
  const events = (eventsRes.data ?? []) as EventRow[];

  // Unique landing page visitors
  const uniqueSessions = new Set(visits.map((v) => v.session_id).filter(Boolean));
  const totalVisitors = uniqueSessions.size;

  // Avg time on page (only sessions that sent a duration)
  const durationsWithValue = visits.filter((v) => v.duration_seconds && v.duration_seconds > 0);
  const avgDuration = durationsWithValue.length > 0
    ? Math.round(durationsWithValue.reduce((sum, v) => sum + (v.duration_seconds ?? 0), 0) / durationsWithValue.length)
    : null;

  // Chat and email counts
  const chatStarted = events.filter((e) => e.event_type === 'chat_started').length;
  const emailSubmitted = events.filter((e) => e.event_type === 'email_submitted').length;

  // Per-source breakdown
  const bySource = new Map<string, { visitors: Set<string>; chats: number; emails: number }>();

  for (const v of visits) {
    const src = v.source ?? 'direct';
    if (!bySource.has(src)) bySource.set(src, { visitors: new Set(), chats: 0, emails: 0 });
    if (v.session_id) bySource.get(src)!.visitors.add(v.session_id);
  }
  for (const e of events) {
    const src = e.source ?? 'direct';
    if (!bySource.has(src)) bySource.set(src, { visitors: new Set(), chats: 0, emails: 0 });
    if (e.event_type === 'chat_started') bySource.get(src)!.chats += 1;
    if (e.event_type === 'email_submitted') bySource.get(src)!.emails += 1;
  }

  const sorted = Array.from(bySource.entries())
    .map(([src, d]) => ({ src, visitors: d.visitors.size, chats: d.chats, emails: d.emails }))
    .sort((a, b) => b.visitors - a.visitors);

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-baseline justify-between">
        <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Website · last 7 days</p>
        <a href="https://www.cerebroai.au" target="_blank" rel="noopener noreferrer"
          className="text-xs text-black/30 hover:text-black/60 transition-colors">
          cerebroai.au ↗
        </a>
      </div>

      {/* Summary stats */}
      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Visitors', value: totalVisitors },
          { label: 'Avg time', value: avgDuration !== null ? fmtDuration(avgDuration) : '—' },
          { label: 'Chats started', value: chatStarted },
          { label: 'Emails captured', value: emailSubmitted },
        ].map((s) => (
          <div key={s.label} className="cb-card border border-black/10 bg-white p-6">
            <p className="text-[1.75rem] font-light leading-none">{s.value}</p>
            <p className="mt-3 text-[0.65rem] uppercase tracking-[0.14em] text-black/45">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Per-source breakdown */}
      {sorted.length > 0 ? (
        <div className="cb-card mb-4 border border-black/10 bg-white divide-y divide-black/[0.06]">
          <div className="grid grid-cols-4 gap-2 px-6 py-3.5">
            <p className="text-[0.55rem] uppercase tracking-[0.14em] text-black/40">Source</p>
            <p className="text-[0.55rem] uppercase tracking-[0.14em] text-black/40 text-right">Visitors</p>
            <p className="text-[0.55rem] uppercase tracking-[0.14em] text-black/40 text-right">Chats</p>
            <p className="text-[0.55rem] uppercase tracking-[0.14em] text-black/40 text-right">Emails</p>
          </div>
          {sorted.map(({ src, visitors, chats, emails }) => (
            <div key={src} className="grid grid-cols-4 gap-2 px-6 py-4 items-center">
              <p className="text-sm font-medium truncate">{label(src)}</p>
              <p className="text-sm text-right">{visitors}</p>
              <p className="text-sm text-right">{chats || '—'}</p>
              <p className="text-sm text-right">{emails || '—'}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="cb-card mb-4 text-sm text-black/45 border border-black/8 px-6 py-5">
          No visitors tracked yet. Data will appear here once people visit the site.
        </p>
      )}
    </section>
  );
}
