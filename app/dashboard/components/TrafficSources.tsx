import { createClient } from '@/utils/supabase/server';

interface VisitRow {
  source: string | null;
  session_id: string | null;
  path: string;
  created_at: string;
}

const SOURCE_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  x: 'X (Twitter)',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  search: 'Search',
  direct: 'Direct',
  other: 'Other',
};

function labelFor(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export default async function TrafficSources() {
  const supabase = await createClient();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data, error } = await supabase
    .from('page_visits')
    .select('source, session_id, path, created_at')
    .gte('created_at', sevenDaysAgo.toISOString())
    .limit(5000);

  if (error) {
    return (
      <div className="border border-black/10 rounded-xl p-6 mb-12">
        <p className="text-sm font-medium text-black mb-2">Traffic sources</p>
        <p className="text-xs text-red-400">
          {error.message.includes('relation') ? 'Run the page_visits migration to enable traffic tracking.' : error.message}
        </p>
      </div>
    );
  }

  const rows = (data ?? []) as VisitRow[];
  const totalVisits = rows.length;

  // Group by source. Count both raw visits and unique sessions per source.
  const bySource = new Map<string, { visits: number; sessions: Set<string> }>();
  for (const r of rows) {
    const key = r.source ?? 'other';
    const entry = bySource.get(key) ?? { visits: 0, sessions: new Set<string>() };
    entry.visits += 1;
    if (r.session_id) entry.sessions.add(r.session_id);
    bySource.set(key, entry);
  }

  const sorted = Array.from(bySource.entries())
    .map(([source, v]) => ({ source, visits: v.visits, uniques: v.sessions.size }))
    .sort((a, b) => b.visits - a.visits);

  // Unique landing-page sessions (path '/'). Best signal of "how many people came to the landing page".
  const landingSessions = new Set<string>();
  for (const r of rows) {
    if (r.path === '/' && r.session_id) landingSessions.add(r.session_id);
  }

  return (
    <div className="mb-12">
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-xs font-medium tracking-[0.12em] uppercase text-black/40">
          Traffic sources · last 7 days
        </p>
        <p className="text-xs text-black/30">
          {totalVisits} visits · {landingSessions.size} unique landing-page visitors
        </p>
      </div>

      {sorted.length === 0 ? (
        <div className="border border-black/10 rounded-xl p-6">
          <p className="text-sm text-black/40">
            No visits tracked yet. Once visitors hit the site, sources will appear here.
          </p>
          <p className="text-xs text-black/30 mt-2">
            Tag your social links with{' '}
            <code className="text-black/60 bg-black/5 px-1 rounded">?utm_source=instagram</code>{' '}
            (or x, youtube, tiktok) for clean attribution.
          </p>
        </div>
      ) : (
        <div className="border border-black/10 rounded-xl divide-y divide-black/10 overflow-hidden">
          {sorted.map(({ source, visits, uniques }) => {
            const pct = totalVisits > 0 ? (visits / totalVisits) * 100 : 0;
            return (
              <div key={source} className="px-5 py-3.5 flex items-center gap-4">
                <div className="w-28 text-sm text-black font-medium truncate">{labelFor(source)}</div>
                <div className="flex-1 h-1.5 bg-black/[0.05] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-black/70 rounded-full"
                    style={{ width: `${Math.max(pct, 1)}%` }}
                  />
                </div>
                <div className="w-32 text-right">
                  <p className="text-sm text-black">{visits}</p>
                  <p className="text-[0.65rem] text-black/40">{uniques} unique · {pct.toFixed(0)}%</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
