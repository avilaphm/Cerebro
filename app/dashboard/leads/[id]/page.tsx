import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';
import { computeStage, STAGES } from '@/utils/leads/tags';
import LeadActions from './LeadActions';
import MilestoneStrip from './MilestoneStrip';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface TagRow {
  tag_slug: string;
  created_at: string;
  source: string;
  metadata: Record<string, unknown> | null;
}

interface TagDef {
  slug: string;
  label: string;
  category: string;
}

interface ProposalRow {
  id: string;
  sent_at: string | null;
  deliverables: string[] | null;
  proposal_html: string | null;
  research_summary: string | null;
  discovery_questions: string | null;
  status: string | null;
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [
    { data: lead },
    { data: tagsRaw },
    { data: tagDefs },
    { data: convRaw },
    { data: proposals },
  ] = await Promise.all([
    supabase
      .from('leads')
      .select(
        'id, created_at, name, email, message, industry, pain_point, current_tools, team_size, budget, timeline, website, source',
      )
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('lead_tags')
      .select('tag_slug, created_at, source, metadata')
      .eq('lead_id', id)
      .order('created_at', { ascending: true }),
    supabase.from('tags').select('slug, label, category'),
    supabase
      .from('conversations')
      .select('messages')
      .eq('lead_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('proposals')
      .select(
        'id, sent_at, deliverables, proposal_html, research_summary, discovery_questions, status',
      )
      .eq('lead_id', id)
      .order('created_at', { ascending: false }),
  ]);

  if (!lead) notFound();

  const tags = (tagsRaw as TagRow[] | null) ?? [];
  const defs = (tagDefs as TagDef[] | null) ?? [];
  const labelOf = (slug: string) => defs.find((d) => d.slug === slug)?.label ?? slug;

  const tagSlugs = tags.map((t) => t.tag_slug);
  const stage = computeStage(tagSlugs);
  const stageLabel = STAGES.find((s) => s.key === stage)?.label ?? stage;

  const conv = convRaw as { messages: ChatMessage[] } | null;
  const messages: ChatMessage[] = conv?.messages ?? [];

  const proposal: ProposalRow | undefined = (proposals as ProposalRow[] | null)?.[0];

  const created = new Date(lead.created_at).toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="p-8 min-h-screen max-w-5xl">
      {/* Breadcrumb */}
      <Link
        href="/dashboard/leads"
        className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black/40 hover:text-black no-underline inline-block mb-2"
      >
        ← Leads
      </Link>

      {/* Header */}
      <div className="mb-8 flex items-baseline justify-between gap-6 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-light tracking-[-0.02em] text-black">
            {lead.name ?? 'Unknown'}
          </h1>
          <p className="text-sm text-black/50 mt-1">{lead.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium tracking-[0.2em] uppercase text-black/40">
            Stage
          </span>
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-black text-white tracking-wider uppercase">
            {stageLabel}
          </span>
        </div>
      </div>

      {/* Horizontal journey strip */}
      <div className="mb-10">
        <MilestoneStrip tags={tagSlugs} />
      </div>

      {/* Two-col layout */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Left: facts + actions */}
        <aside className="md:col-span-1 space-y-6">
          <Section title="Lead">
            <Field label="Captured" value={created} />
            <Field label="Source"   value={lead.source ?? '—'} />
            <Field label="Industry" value={lead.industry ?? '—'} />
            <Field label="Website" value={
              lead.website ? (
                <a
                  href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-black hover:underline"
                >
                  {lead.website.replace(/^https?:\/\/(www\.)?/, '')}
                </a>
              ) : '—'
            } />
            <Field label="Team"     value={lead.team_size ?? '—'} />
            <Field label="Tools"    value={lead.current_tools ?? '—'} />
            <Field label="Budget"   value={lead.budget ?? '—'} />
            <Field label="Timeline" value={lead.timeline ?? '—'} />
          </Section>

          <Section title="What they want">
            <p className="text-sm text-black/70 leading-relaxed">
              {lead.pain_point ?? lead.message ?? 'Not captured.'}
            </p>
          </Section>

          {proposal?.deliverables && proposal.deliverables.length > 0 && (
            <Section title="What we'd build">
              <ul className="space-y-2">
                {proposal.deliverables.map((d, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-black/70">
                    <span className="text-black/30 mt-1 flex-shrink-0">•</span>
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <LeadActions leadId={lead.id} stage={stage} initialTags={tagSlugs} />
        </aside>

        {/* Right: timeline + transcript + proposal */}
        <div className="md:col-span-2 space-y-8">
          <Section title="Engagement timeline">
            {tags.length === 0 ? (
              <p className="text-sm text-black/40">No tags yet.</p>
            ) : (
              <ol className="space-y-3">
                {tags.map((t, i) => {
                  const at = new Date(t.created_at).toLocaleString('en-AU', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  });
                  return (
                    <li key={`${t.tag_slug}-${i}`} className="flex items-start gap-3 text-sm">
                      <span className="text-black/30 font-mono text-xs w-32 flex-shrink-0 pt-0.5">
                        {at}
                      </span>
                      <span className="font-medium text-black">{labelOf(t.tag_slug)}</span>
                      <span className="text-black/40 text-xs">
                        ({t.source})
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </Section>

          {messages.length > 0 && (
            <Section title="Chat transcript">
              <div className="space-y-3 max-h-[420px] overflow-y-auto pr-2">
                {messages.map((m, i) => (
                  <div key={i} className="text-sm">
                    <p className="text-[10px] tracking-widest uppercase text-black/40 mb-1">
                      {m.role === 'user' ? 'Visitor' : 'Cerebro'}
                    </p>
                    <p className="text-black/80 leading-relaxed whitespace-pre-wrap">
                      {m.content}
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {proposal?.discovery_questions && (
            <Section title="Discovery questions for the call">
              <pre className="text-sm text-black/70 whitespace-pre-wrap font-sans leading-relaxed">
                {proposal.discovery_questions}
              </pre>
            </Section>
          )}

          {proposal?.research_summary && (
            <Section title="Research summary">
              <pre className="text-xs text-black/60 whitespace-pre-wrap font-sans leading-relaxed bg-black/[0.02] p-4 rounded-lg">
                {proposal.research_summary}
              </pre>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[10px] font-medium tracking-[0.2em] uppercase text-black/40 mb-3">
        {title}
      </h2>
      <div className="border border-black/10 rounded-xl p-5 bg-white">{children}</div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm border-b border-black/5 last:border-0">
      <span className="text-black/40 text-xs">{label}</span>
      <span className="text-black/80 text-right">{value}</span>
    </div>
  );
}
