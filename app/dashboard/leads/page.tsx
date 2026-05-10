'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import {
  TAG,
  computeStage,
  hasTag,
  progressIndex,
  progressStages,
  STAGES,
  type Stage,
  type TagSlug,
} from '@/utils/leads/tags';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Proposal {
  sent_at: string | null;
  deliverables: string[] | null;
}

interface Lead {
  id: string;
  created_at: string;
  name: string | null;
  email: string | null;
  industry: string | null;
  pain_point: string | null;
  website: string | null;
  proposals: Proposal[];
  tags: string[];
}

// ─── Engagement chips for the card ────────────────────────────────────────────

const CHIPS: { tag: TagSlug; label: string }[] = [
  { tag: TAG.EMAIL1_OPENED,       label: 'Welcome opened'      },
  { tag: TAG.EMAIL2_OPENED,       label: 'Proposal email opened' },
  { tag: TAG.PROPOSAL_VIEWED,     label: 'Proposal page viewed'  },
  { tag: TAG.PROPOSAL_DOWNLOADED, label: 'PDF downloaded'      },
  { tag: TAG.CALL_BOOKED,         label: 'Call booked'         },
  { tag: TAG.CALL_COMPLETED,      label: 'Call done'           },
];

// ─── Lead card ────────────────────────────────────────────────────────────────

function LeadCard({
  lead,
  onUpdate,
}: {
  lead: Lead;
  onUpdate: (id: string, patch: Partial<Lead>) => void;
}) {
  const supabase = createClient();
  const stage = computeStage(lead.tags);
  const currentIdx = progressIndex(stage);
  const proposal = lead.proposals?.[0];

  async function addTagAction(slug: TagSlug) {
    const nextTags = Array.from(new Set([...lead.tags, slug]));
    onUpdate(lead.id, { tags: nextTags });
    const { error } = await supabase
      .from('lead_tags')
      .upsert(
        { lead_id: lead.id, tag_slug: slug, source: 'manual' },
        { onConflict: 'lead_id,tag_slug', ignoreDuplicates: true },
      );
    if (error) console.error('addTag error:', error);
  }

  const dateLabel = new Date(lead.created_at).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
  });

  const PROGRESS = progressStages();

  return (
    <Link
      href={`/dashboard/leads/${lead.id}`}
      className="bg-white border border-black/10 rounded-xl p-4 flex flex-col gap-3 hover:border-black/30 transition-colors no-underline"
    >
      {/* Progress dots */}
      <div className="flex items-center gap-1.5">
        {PROGRESS.map((s, i) => {
          const filled = stage === 'client'
            ? true
            : stage === 'lost'
            ? i < currentIdx
            : i <= currentIdx;
          return (
            <div
              key={s}
              className={`w-2 h-2 rounded-full transition-colors ${
                stage === 'lost' && i === currentIdx
                  ? 'bg-red-400'
                  : filled
                  ? 'bg-black'
                  : 'bg-black/15'
              }`}
            />
          );
        })}
        <span className="ml-1 text-[10px] text-black/30 uppercase tracking-widest">
          {STAGES.find((s) => s.key === stage)?.label}
        </span>
      </div>

      {/* Name + date */}
      <div>
        <p className="font-medium text-sm text-black leading-snug">
          {lead.name ?? 'Unknown'}
        </p>
        <p className="text-xs text-black/40 mt-0.5">{dateLabel}</p>
      </div>

      {/* Business + website */}
      <div className="space-y-0.5">
        {lead.industry && (
          <p className="text-xs text-black/60">{lead.industry}</p>
        )}
        {lead.website && (
          <span className="text-xs text-black/40 truncate block">
            ↗ {lead.website.replace(/^https?:\/\/(www\.)?/, '')}
          </span>
        )}
      </div>

      {/* Pain point */}
      {lead.pain_point && (
        <p className="text-xs text-black/50 leading-relaxed line-clamp-2">
          {lead.pain_point}
        </p>
      )}

      {/* Deliverables */}
      {proposal?.deliverables && proposal.deliverables.length > 0 ? (
        <div>
          <p className="text-[10px] font-medium tracking-[0.15em] uppercase text-black/30 mb-1.5">
            What we'd build
          </p>
          <ul className="space-y-1">
            {proposal.deliverables.map((d, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="text-black/20 mt-0.5 flex-shrink-0 text-xs">•</span>
                <span className="text-xs text-black/60 leading-snug">{d}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-black/25 italic">
          {proposal?.sent_at ? 'Proposal sent' : 'Proposal pending'}
        </p>
      )}

      {/* Engagement chips — only show the ones that fired */}
      {CHIPS.some((c) => hasTag(lead.tags, c.tag)) && (
        <div className="flex flex-wrap gap-1 pt-1 border-t border-black/5">
          {CHIPS.filter((c) => hasTag(lead.tags, c.tag)).map((c) => (
            <span
              key={c.tag}
              className="text-[10px] tracking-wider px-2 py-0.5 rounded-full bg-black/5 text-black/60"
            >
              {c.label}
            </span>
          ))}
        </div>
      )}

      {/* Email */}
      {lead.email && (
        <p className="text-[10px] text-black/30 truncate">{lead.email}</p>
      )}

      {/* Actions — only render in stages where they apply */}
      <div
        className="flex flex-col gap-1.5 pt-1 border-t border-black/5"
        onClick={(e) => e.preventDefault()}
      >
        {(stage === 'email2_sent' || stage === 'proposal_viewed') && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              addTagAction(TAG.CALL_BOOKED);
            }}
            className="text-xs px-3 py-1.5 rounded-lg border border-black/15 text-black/60 hover:border-black/40 hover:text-black transition-colors text-left"
          >
            Mark call booked
          </button>
        )}
        {stage === 'call_booked' && (
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                addTagAction(TAG.CLIENT);
              }}
              className="flex-1 text-xs px-3 py-1.5 rounded-lg bg-black text-white hover:opacity-80 transition-opacity"
            >
              Became client
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                addTagAction(TAG.NOT_CLIENT);
              }}
              className="flex-1 text-xs px-3 py-1.5 rounded-lg border border-black/15 text-black/50 hover:border-black/40 hover:text-black transition-colors"
            >
              Didn't convert
            </button>
          </div>
        )}
      </div>
    </Link>
  );
}

// ─── Pipeline column ──────────────────────────────────────────────────────────

function PipelineColumn({
  label,
  leads,
  onUpdate,
}: {
  label: string;
  leads: Lead[];
  onUpdate: (id: string, patch: Partial<Lead>) => void;
}) {
  return (
    <div className="flex-shrink-0 w-60">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[0.6rem] font-medium tracking-[0.18em] uppercase text-black/40">
          {label}
        </p>
        {leads.length > 0 && (
          <span className="text-[0.6rem] font-medium text-black/25 bg-black/5 rounded-full px-1.5 py-0.5">
            {leads.length}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {leads.length === 0 ? (
          <div className="border border-dashed border-black/10 rounded-xl p-4 text-center">
            <p className="text-xs text-black/25">No leads here yet</p>
          </div>
        ) : (
          leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onUpdate={onUpdate} />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface LeadTagRow {
  lead_id: string;
  tag_slug: string;
}

export default function LeadsPage() {
  const supabase = createClient();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLeads = useCallback(async () => {
    const [{ data: leadRows, error: leadErr }, { data: tagRows, error: tagErr }] =
      await Promise.all([
        supabase
          .from('leads')
          .select(
            'id, created_at, name, email, industry, pain_point, website, proposals(sent_at, deliverables)',
          )
          .order('created_at', { ascending: false })
          .limit(200),
        supabase.from('lead_tags').select('lead_id, tag_slug'),
      ]);

    if (leadErr) console.error('Leads fetch error:', leadErr);
    if (tagErr) console.error('Tags fetch error:', tagErr);

    const tagsByLead = new Map<string, string[]>();
    (tagRows as LeadTagRow[] | null)?.forEach((row) => {
      const list = tagsByLead.get(row.lead_id) ?? [];
      list.push(row.tag_slug);
      tagsByLead.set(row.lead_id, list);
    });

    type LeadRow = Omit<Lead, 'tags'>;
    const merged = ((leadRows as LeadRow[] | null) ?? []).map<Lead>((l) => ({
      ...l,
      tags: tagsByLead.get(l.id) ?? [],
    }));

    setLeads(merged);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  function handleUpdate(id: string, patch: Partial<Lead>) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  const byStage = (stage: Stage) =>
    leads.filter((l) => computeStage(l.tags) === stage);

  return (
    <div className="p-8 min-h-screen">
      <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black/40 mb-2">
        Dashboard
      </p>
      <h1 className="font-display text-3xl font-light tracking-[-0.02em] text-black mb-8">
        Leads
      </h1>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-black/40">
          <span className="inline-block w-3.5 h-3.5 border-2 border-black/20 border-t-black/60 rounded-full animate-spin" />
          Loading leads…
        </div>
      ) : (
        <div className="overflow-x-auto pb-8">
          <div className="flex gap-5" style={{ minWidth: 'max-content' }}>
            {STAGES.map(({ key, label }) => (
              <PipelineColumn
                key={key}
                label={label}
                leads={byStage(key)}
                onUpdate={handleUpdate}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
