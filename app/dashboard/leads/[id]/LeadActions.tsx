'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { TAG, type Stage, type TagSlug } from '@/utils/leads/tags';

export default function LeadActions({
  leadId,
  stage,
  initialTags,
}: {
  leadId: string;
  stage: Stage;
  initialTags: string[];
}) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [tags, setTags] = useState<string[]>(initialTags);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function add(slug: TagSlug) {
    setError(null);
    setTags((prev) => Array.from(new Set([...prev, slug])));
    const { error: e } = await supabase
      .from('lead_tags')
      .upsert(
        { lead_id: leadId, tag_slug: slug, source: 'manual' },
        { onConflict: 'lead_id,tag_slug', ignoreDuplicates: true },
      );
    if (e) {
      setError(e.message);
      return;
    }
    startTransition(() => router.refresh());
  }

  async function remove(slug: TagSlug) {
    setError(null);
    setTags((prev) => prev.filter((s) => s !== slug));
    const { error: e } = await supabase
      .from('lead_tags')
      .delete()
      .eq('lead_id', leadId)
      .eq('tag_slug', slug);
    if (e) {
      setError(e.message);
      return;
    }
    startTransition(() => router.refresh());
  }

  async function deleteLead() {
    setError(null);
    setDeleting(true);
    const { error: e } = await supabase.from('leads').delete().eq('id', leadId);
    if (e) {
      setError(e.message);
      setDeleting(false);
      return;
    }
    router.push('/dashboard/leads');
  }

  const has = (s: TagSlug) => tags.includes(s);

  // ── Confirmation pane (step 2 of delete) ──────────────────────────────────
  if (confirmingDelete) {
    return (
      <section>
        <h2 className="text-[10px] font-medium tracking-[0.2em] uppercase text-black/40 mb-3">
          Delete lead?
        </h2>
        <div className="border border-red-200 rounded-xl p-5 bg-red-50/40 space-y-4">
          <p className="text-sm text-black/75 leading-relaxed">
            This permanently removes the lead, the chat transcript, all engagement tags, and any proposals. It cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={deleteLead}
              disabled={deleting}
              className="flex-1 text-xs px-3 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Yes, delete permanently'}
            </button>
            <button
              onClick={() => setConfirmingDelete(false)}
              disabled={deleting}
              className="flex-1 text-xs px-3 py-2 rounded-lg border border-black/15 text-black/60 hover:border-black/40 hover:text-black transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      </section>
    );
  }

  // ── Default action panel ──────────────────────────────────────────────────
  return (
    <section>
      <h2 className="text-[10px] font-medium tracking-[0.2em] uppercase text-black/40 mb-3">
        Actions
      </h2>
      <div className="border border-black/10 rounded-xl p-5 bg-white space-y-2">
        {stage === 'stage1' && !has(TAG.CALL_BOOKED) && (
          <button
            onClick={() => add(TAG.CALL_BOOKED)}
            disabled={busy}
            className="w-full text-xs px-3 py-2 rounded-lg border border-black/15 text-black/60 hover:border-black/40 hover:text-black transition-colors text-left disabled:opacity-50"
          >
            Mark call booked
          </button>
        )}

        {stage === 'call_booked' && !has(TAG.CALL_COMPLETED) && (
          <button
            onClick={() => add(TAG.CALL_COMPLETED)}
            disabled={busy}
            className="w-full text-xs px-3 py-2 rounded-lg border border-black/15 text-black/60 hover:border-black/40 hover:text-black transition-colors text-left disabled:opacity-50"
          >
            Mark call completed
          </button>
        )}

        {(stage === 'call_booked' || has(TAG.CALL_COMPLETED)) && !has(TAG.CLIENT) && !has(TAG.NOT_CLIENT) && (
          <div className="flex gap-2">
            <button
              onClick={() => add(TAG.CLIENT)}
              disabled={busy}
              className="flex-1 text-xs px-3 py-2 rounded-lg bg-black text-white hover:opacity-80 transition-opacity disabled:opacity-50"
            >
              Became client
            </button>
            <button
              onClick={() => add(TAG.NOT_CLIENT)}
              disabled={busy}
              className="flex-1 text-xs px-3 py-2 rounded-lg border border-black/15 text-black/60 hover:border-black/40 hover:text-black transition-colors disabled:opacity-50"
            >
              Didn't convert
            </button>
          </div>
        )}

        {!has(TAG.LOST) ? (
          <button
            onClick={() => add(TAG.LOST)}
            disabled={busy}
            className="w-full text-xs px-3 py-2 rounded-lg text-black/40 hover:text-red-600 transition-colors text-left disabled:opacity-50"
          >
            Mark lost
          </button>
        ) : (
          <button
            onClick={() => remove(TAG.LOST)}
            disabled={busy}
            className="w-full text-xs px-3 py-2 rounded-lg text-black/40 hover:text-black transition-colors text-left disabled:opacity-50"
          >
            Un-mark lost
          </button>
        )}

        <button
          onClick={() => setConfirmingDelete(true)}
          disabled={busy}
          className="w-full text-xs px-3 py-2 rounded-lg text-red-600/70 hover:text-red-700 hover:bg-red-50 transition-colors text-left disabled:opacity-50"
        >
          Delete lead…
        </button>

        {error && <p className="text-xs text-red-600 pt-2">{error}</p>}
      </div>
    </section>
  );
}
