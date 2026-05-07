'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

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
  email_opened: boolean;
  call_booked: boolean;
  became_client: boolean | null;
  proposals: Proposal[];
}

type Stage = 'fresh' | 'proposal_sent' | 'email_opened' | 'call_booked' | 'client' | 'lost';

// ─── Stage config ─────────────────────────────────────────────────────────────

const STAGE_CONFIG: { key: Stage; label: string }[] = [
  { key: 'fresh',         label: 'Fresh Lead' },
  { key: 'proposal_sent', label: 'Proposal Sent' },
  { key: 'email_opened',  label: 'Opened Email' },
  { key: 'call_booked',   label: 'Call Booked' },
  { key: 'client',        label: 'Client' },
  { key: 'lost',          label: 'Lost' },
];

const PROGRESS_STAGES: Stage[] = ['fresh', 'proposal_sent', 'email_opened', 'call_booked', 'client'];

function getStage(lead: Lead): Stage {
  if (lead.became_client === true)  return 'client';
  if (lead.became_client === false) return 'lost';
  if (lead.call_booked)             return 'call_booked';
  if (lead.email_opened)            return 'email_opened';
  if (lead.proposals?.[0]?.sent_at) return 'proposal_sent';
  return 'fresh';
}

function stageIndex(stage: Stage): number {
  return PROGRESS_STAGES.indexOf(stage);
}

// ─── Lead card ────────────────────────────────────────────────────────────────

function LeadCard({
  lead,
  onUpdate,
}: {
  lead: Lead;
  onUpdate: (id: string, patch: Partial<Lead>) => void;
}) {
  const supabase = createClient();
  const stage = getStage(lead);
  const currentIdx = stageIndex(stage);
  const proposal = lead.proposals?.[0];

  async function patch(data: Partial<Lead>) {
    onUpdate(lead.id, data);
    await supabase.from('leads').update(data).eq('id', lead.id);
  }

  const dateLabel = new Date(lead.created_at).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
  });

  return (
    <div className="bg-white border border-black/10 rounded-xl p-4 flex flex-col gap-3">
      {/* Progress dots */}
      <div className="flex items-center gap-1.5">
        {PROGRESS_STAGES.map((s, i) => {
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
          {STAGE_CONFIG.find((s) => s.key === stage)?.label}
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
          <a
            href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-black/40 hover:text-black transition-colors truncate block"
          >
            ↗ {lead.website.replace(/^https?:\/\/(www\.)?/, '')}
          </a>
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

      {/* Email */}
      {lead.email && (
        <p className="text-[10px] text-black/30 truncate">{lead.email}</p>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-1.5 pt-1 border-t border-black/5">
        {(stage === 'proposal_sent' || stage === 'email_opened') && (
          <button
            onClick={() => patch({ call_booked: true })}
            className="text-xs px-3 py-1.5 rounded-lg border border-black/15 text-black/60 hover:border-black/40 hover:text-black transition-colors text-left"
          >
            Mark call booked
          </button>
        )}
        {stage === 'call_booked' && (
          <div className="flex gap-1.5">
            <button
              onClick={() => patch({ became_client: true })}
              className="flex-1 text-xs px-3 py-1.5 rounded-lg bg-black text-white hover:opacity-80 transition-opacity"
            >
              Became client
            </button>
            <button
              onClick={() => patch({ became_client: false })}
              className="flex-1 text-xs px-3 py-1.5 rounded-lg border border-black/15 text-black/50 hover:border-black/40 hover:text-black transition-colors"
            >
              Didn't convert
            </button>
          </div>
        )}
        {stage === 'lost' && (
          <button
            disabled
            title="Nurture email sequences coming soon"
            className="text-xs px-3 py-1.5 rounded-lg border border-dashed border-black/15 text-black/25 cursor-not-allowed"
          >
            Nurture sequence — coming soon
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Pipeline column ──────────────────────────────────────────────────────────

function PipelineColumn({
  stage,
  label,
  leads,
  onUpdate,
}: {
  stage: Stage;
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

export default function LeadsPage() {
  const supabase = createClient();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLeads = useCallback(async () => {
    const { data, error } = await supabase
      .from('leads')
      .select('id, created_at, name, email, industry, pain_point, website, email_opened, call_booked, became_client, proposals(sent_at, deliverables)')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      console.error('Leads fetch error:', error);
    }
    setLeads((data as Lead[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadLeads(); }, [loadLeads]);

  function handleUpdate(id: string, patch: Partial<Lead>) {
    setLeads((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    );
  }

  const byStage = (stage: Stage) =>
    leads.filter((l) => getStage(l) === stage);

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
            {STAGE_CONFIG.map(({ key, label }) => (
              <PipelineColumn
                key={key}
                stage={key}
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
