'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import {
  TAG,
  computeStage,
  hasTag,
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

// ─── Engagement milestones shown inside each card ────────────────────────────
// Each milestone resolves green when ANY of its match tags is present.
// Order = the order Pedro talked about: email1 sent → email2 sent → opened →
// PDF downloaded → booking link clicked.

interface Milestone {
  label: string;
  match: TagSlug[];
}

const MILESTONES: Milestone[] = [
  { label: 'Email 1 sent',         match: [TAG.EMAIL1_SENT] },
  { label: 'Email 2 sent',         match: [TAG.EMAIL2_SENT] },
  { label: 'Proposal opened',      match: [TAG.EMAIL2_OPENED, TAG.PROPOSAL_VIEWED] },
  { label: 'PDF downloaded',       match: [TAG.PROPOSAL_DOWNLOADED] },
  { label: 'Booking link clicked', match: [TAG.CALL_BOOKED] },
];

// ─── Lead card ────────────────────────────────────────────────────────────────

function LeadCard({ lead }: { lead: Lead }) {
  const stage = computeStage(lead.tags);
  const stageLabel = STAGES.find((s) => s.key === stage)?.label ?? stage;
  const proposal = lead.proposals?.[0];

  const dateLabel = new Date(lead.created_at).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
  });

  return (
    <Link
      href={`/dashboard/leads/${lead.id}`}
      className="group block bg-white border border-black/10 rounded-2xl p-6 hover:border-black/30 hover:shadow-[0_2px_24px_rgba(0,0,0,0.04)] transition-all no-underline"
    >
      {/* Header: stage label + capture date */}
      <div className="flex items-center justify-between mb-5">
        <span className="text-[10px] font-medium tracking-[0.2em] uppercase text-black/50">
          {stageLabel}
        </span>
        <span className="text-[10px] tracking-wider text-black/30 uppercase">
          {dateLabel}
        </span>
      </div>

      {/* Name + email */}
      <div className="mb-5">
        <p className="font-medium text-base text-black leading-snug">
          {lead.name ?? 'Unknown'}
        </p>
        {lead.email && (
          <p className="text-xs text-black/40 mt-1 truncate">{lead.email}</p>
        )}
      </div>

      {/* Business + website */}
      {(lead.industry || lead.website) && (
        <div className="mb-5 space-y-1">
          {lead.industry && (
            <p className="text-xs text-black/60">{lead.industry}</p>
          )}
          {lead.website && (
            <span className="text-xs text-black/40 truncate block">
              ↗ {lead.website.replace(/^https?:\/\/(www\.)?/, '')}
            </span>
          )}
        </div>
      )}

      {/* Pain point */}
      {lead.pain_point && (
        <p className="text-xs text-black/55 leading-relaxed line-clamp-3 mb-5">
          {lead.pain_point}
        </p>
      )}

      {/* Engagement milestones — the live "green light" timeline */}
      <div className="mb-5">
        <p className="text-[9px] font-medium tracking-[0.2em] uppercase text-black/35 mb-3">
          Progress
        </p>
        <ol className="space-y-2">
          {MILESTONES.map((m) => {
            const done = m.match.some((t) => hasTag(lead.tags, t));
            return (
              <li key={m.label} className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors ${
                    done ? 'bg-emerald-500' : 'bg-black/10'
                  }`}
                />
                <span
                  className={`text-xs transition-colors ${
                    done ? 'text-black' : 'text-black/35'
                  }`}
                >
                  {m.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Deliverables */}
      {proposal?.deliverables && proposal.deliverables.length > 0 && (
        <div className="pt-4 border-t border-black/5">
          <p className="text-[9px] font-medium tracking-[0.2em] uppercase text-black/35 mb-2">
            What we'd build
          </p>
          <ul className="space-y-1.5">
            {proposal.deliverables.map((d, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-black/20 mt-0.5 flex-shrink-0 text-xs">•</span>
                <span className="text-xs text-black/65 leading-snug">{d}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Link>
  );
}

// ─── Pipeline column ──────────────────────────────────────────────────────────

function PipelineColumn({
  label,
  leads,
}: {
  label: string;
  leads: Lead[];
}) {
  return (
    <div className="flex-shrink-0 w-[22rem]">
      <div className="flex items-center justify-between mb-5 px-1">
        <p className="text-[10px] font-medium tracking-[0.2em] uppercase text-black/50">
          {label}
        </p>
        {leads.length > 0 && (
          <span className="text-[10px] font-medium text-black/30 bg-black/[0.04] rounded-full px-2 py-0.5">
            {leads.length}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-5">
        {leads.length === 0 ? (
          <div className="border border-dashed border-black/10 rounded-2xl py-10 text-center">
            <p className="text-xs text-black/25">No leads here yet</p>
          </div>
        ) : (
          leads.map((lead) => <LeadCard key={lead.id} lead={lead} />)
        )}
      </div>
    </div>
  );
}

// ─── Mobile section ───────────────────────────────────────────────────────────

function MobileSection({ label, leads }: { label: string; leads: Lead[] }) {
  if (leads.length === 0) return null;
  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[10px] font-medium tracking-[0.2em] uppercase text-black/50">
          {label}
        </p>
        <span className="text-[10px] font-medium text-black/30 bg-black/[0.04] rounded-full px-2 py-0.5">
          {leads.length}
        </span>
      </div>
      <div className="flex flex-col gap-4">
        {leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} />
        ))}
      </div>
    </section>
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

  const byStage = (stage: Stage) =>
    leads.filter((l) => computeStage(l.tags) === stage);

  return (
    <div className="p-6 md:p-10 min-h-screen">
      <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black/40 mb-2">
        Dashboard
      </p>
      <h1 className="font-display text-3xl md:text-4xl font-light tracking-[-0.02em] text-black mb-8 md:mb-10">
        Leads
      </h1>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-black/40">
          <span className="inline-block w-3.5 h-3.5 border-2 border-black/20 border-t-black/60 rounded-full animate-spin" />
          Loading leads…
        </div>
      ) : (
        <>
          {/* Desktop: horizontal Kanban */}
          <div className="hidden md:block overflow-x-auto pb-10">
            <div className="flex gap-8" style={{ minWidth: 'max-content' }}>
              {STAGES.map(({ key, label }) => (
                <PipelineColumn key={key} label={label} leads={byStage(key)} />
              ))}
            </div>
          </div>

          {/* Mobile: stacked sections, only stages with leads shown */}
          <div className="md:hidden">
            {STAGES.map(({ key, label }) => (
              <MobileSection key={key} label={label} leads={byStage(key)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
