'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

interface ClientGroup {
  clientId: string;
  clientName: string;
  changes: string[];
}

// Pillar C - proactive ask-why. Surfaces the programme changes the coach recently made across
// clients that don't yet have a reason, and lets the coach explain why. Each explanation is
// distilled (distill-coaching-learnings) into that client's brain, feeding future generation.
export default function RecentChangesReview() {
  const supabase = createClient();
  const [groups, setGroups] = useState<ClientGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [why, setWhy] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: events } = await supabase
      .from('pt_events')
      .select('id, client_id, event_type, metadata, created_at')
      .in('event_type', ['programme_exercise_swapped', 'programme_exercise_removed', 'programme_sets_changed'])
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(60);

    const unexplained = (events ?? []).filter((e) => !((e.metadata ?? {}) as Record<string, unknown>).reason);
    const clientIds = Array.from(new Set(unexplained.map((e) => e.client_id as string)));
    if (clientIds.length === 0) { setGroups([]); setLoading(false); return; }

    const { data: clients } = await supabase.from('pt_clients').select('id, name').in('id', clientIds);
    const nameById = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]));

    const byClient = new Map<string, string[]>();
    for (const e of unexplained) {
      const m = (e.metadata ?? {}) as Record<string, unknown>;
      let desc = '';
      if (e.event_type === 'programme_exercise_swapped' && Array.isArray(m.swaps)) {
        desc = (m.swaps as Array<{ from?: string; to?: string }>).map((s) => `${s.from ?? '?'} → ${s.to ?? '?'}`).join(', ');
      } else if (e.event_type === 'programme_exercise_removed') {
        desc = 'removed an exercise';
      } else {
        desc = 'changed sets';
      }
      if (!desc) continue;
      const arr = byClient.get(e.client_id as string) ?? [];
      if (arr.length < 6) arr.push(desc);
      byClient.set(e.client_id as string, arr);
    }

    setGroups(clientIds
      .map((id) => ({ clientId: id, clientName: nameById.get(id) ?? 'Client', changes: byClient.get(id) ?? [] }))
      .filter((g) => g.changes.length > 0));
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const learn = async (clientId: string) => {
    setBusy(clientId);
    const { data } = await supabase.functions.invoke('distill-coaching-learnings', {
      body: { client_id: clientId, why: why[clientId] ?? '' },
    });
    setBusy(null);
    const r = data as { learnings?: string[] };
    setDone((d) => ({ ...d, [clientId]: `Saved ${r?.learnings?.length ?? 0} learning(s) to the brain.` }));
    setGroups((g) => g.filter((x) => x.clientId !== clientId));
  };

  if (loading || groups.length === 0) return null;

  return (
    <div className="border border-black/8 p-5">
      <h2 className="mb-1 text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Recent changes — tell me why</h2>
      <p className="mb-4 max-w-2xl text-xs text-black/45">You recently adjusted these clients&apos; programmes. Tell the AI why and it learns your reasoning, so future programmes reflect how you coach.</p>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.clientId} className="border border-black/8 p-3">
            <p className="mb-1 text-sm font-medium text-black/80">{g.clientName}</p>
            <p className="mb-2 text-xs text-black/50">{g.changes.join(' · ')}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={why[g.clientId] ?? ''}
                onChange={(e) => setWhy((w) => ({ ...w, [g.clientId]: e.target.value }))}
                placeholder="Why did you make these changes?"
                className="flex-1 border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/40"
              />
              <button
                type="button"
                onClick={() => void learn(g.clientId)}
                disabled={busy === g.clientId}
                className="border border-black bg-black px-4 py-2 text-sm text-white transition-colors hover:bg-white hover:text-black disabled:opacity-40"
              >
                {busy === g.clientId ? 'Learning…' : 'Learn'}
              </button>
            </div>
            {done[g.clientId] && <p className="mt-1 text-xs text-emerald-700">✓ {done[g.clientId]}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
