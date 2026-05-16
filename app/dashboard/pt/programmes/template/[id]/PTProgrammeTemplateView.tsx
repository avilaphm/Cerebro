'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { PTProgramTemplate, PTClient } from '@/utils/pt/types';

export default function PTProgrammeTemplateView({
  template,
  clients,
}: {
  template: PTProgramTemplate;
  clients: PTClient[];
}) {
  const router = useRouter();
  const [assigning, setAssigning] = useState(false);
  const [clientId, setClientId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const totalDays = template.programme.phases.reduce((sum, ph) => sum + ph.days.length, 0);

  const assign = async () => {
    if (!clientId) return;
    setLoading(true);
    setError('');
    const res = await fetch('/api/pt/programmes/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: template.id, client_id: clientId }),
    });
    if (res.ok) {
      router.push(`/dashboard/pt/clients/${clientId}`);
    } else {
      setError('Could not assign programme. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl px-5 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <Link href="/dashboard/pt/programmes" className="text-black/30 hover:text-black text-sm transition-colors">
          ← Programmes
        </Link>
        <span className="text-black/20">/</span>
        <span className="text-sm text-black/50">{template.name}</span>
      </div>

      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-light tracking-[-0.02em] mb-1">{template.name}</h1>
          {template.goal && <p className="text-sm text-black/50">{template.goal}</p>}
          <p className="text-xs text-black/30 mt-2">
            {template.duration_weeks} weeks · {template.phase_count} phases · {totalDays} workout days
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/dashboard/pt/programmes/template/${template.id}/edit`}
            className="border border-black/20 px-5 py-2.5 text-sm hover:border-black/40 transition-colors"
          >
            Edit template
          </Link>
          <button
            onClick={() => { setAssigning((v) => !v); setClientId(''); setError(''); }}
            className="border border-black bg-black px-5 py-2.5 text-sm text-white hover:bg-white hover:text-black transition-colors"
          >
            Assign to client
          </button>
        </div>
      </div>

      {assigning && (
        <div className="mb-8 border border-black/15 p-5 max-w-sm">
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-3">Assign to client</p>
          <p className="text-xs text-black/40 mb-4">
            A copy of this programme will be added to the client&apos;s profile. Edits to the client&apos;s copy won&apos;t affect this template.
          </p>
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="w-full border border-black/15 px-3 py-2.5 text-sm outline-none focus:border-black/40 mb-4"
          >
            <option value="">— Select client —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
            ))}
          </select>
          {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
          <div className="flex gap-3">
            <button
              onClick={() => { setAssigning(false); setError(''); }}
              className="border border-black/15 px-4 py-2 text-sm hover:bg-black/5 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void assign()}
              disabled={!clientId || loading}
              className="flex-1 border border-black bg-black text-white py-2 text-sm disabled:opacity-30 hover:bg-white hover:text-black transition-colors"
            >
              {loading ? 'Assigning…' : 'Assign'}
            </button>
          </div>
        </div>
      )}

      <div className="mb-8">
        <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-4">Phases</p>
        <div className="space-y-2">
          {template.programme.phases.map((ph, i) => (
            <div key={ph.id} className="border border-black/10 px-5 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{ph.title || `Phase ${i + 1}`}</p>
                  <p className="text-xs text-black/40 mt-0.5">
                    {ph.weeks ? `${ph.weeks} weeks` : 'Duration not set'}{ph.focus ? ` · ${ph.focus}` : ''}
                  </p>
                </div>
                <p className="text-xs text-black/30 shrink-0 ml-4">{ph.days.length} day{ph.days.length !== 1 ? 's' : ''}</p>
              </div>
              {ph.week_blocks && ph.week_blocks.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {ph.week_blocks.map((block, bi) => (
                    <span key={bi} className="flex items-center gap-1">
                      <span className="text-[0.55rem] text-black/40 border border-black/10 px-1.5 py-0.5">
                        {block.sets ? `${block.sets} sets` : block.weight_pct} · {block.weeks}w
                      </span>
                      {bi < (ph.week_blocks?.length ?? 0) - 1 && (
                        <span className="text-black/20 text-[0.6rem]">→</span>
                      )}
                    </span>
                  ))}
                </div>
              )}
              {ph.days.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {ph.days.map((day) => (
                    <span key={day.id} className="text-[0.6rem] uppercase tracking-[0.08em] border border-black/8 bg-black/[0.02] px-2 py-1 text-black/45">
                      {day.title} · {day.exercises.length} ex
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
