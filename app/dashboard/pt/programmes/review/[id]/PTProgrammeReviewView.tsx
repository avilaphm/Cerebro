'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import type {
  PTKnowledgeRetrievalLog,
  PTProgramGenerationRun,
  PTProgramGenerationStep,
  PTProgramReviewOutput,
} from '@/utils/pt/types';

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return asArray(value).map((item) => String(item)).filter(Boolean);
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function countExercises(run: PTProgramGenerationRun) {
  return run.programme_draft.phases.reduce((phaseTotal, phase) => (
    phaseTotal + phase.days.reduce((dayTotal, day) => dayTotal + day.exercises.length, 0)
  ), 0);
}

function StatusPill({ status }: { status: string }) {
  const tone = status === 'failed'
    ? 'border-red-200 bg-red-50 text-red-600'
    : status === 'succeeded' || status === 'approved' || status === 'saved'
      ? 'border-green-200 bg-green-50 text-green-700'
      : status === 'running'
        ? 'border-blue-200 bg-blue-50 text-blue-700'
        : 'border-amber-200 bg-amber-50 text-amber-700';
  return (
    <span className={`border px-2 py-0.5 text-[0.58rem] uppercase tracking-[0.12em] ${tone}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function DetailList({ items, emptyText }: { items: string[]; emptyText: string }) {
  if (items.length === 0) return <p className="text-sm text-black/35">{emptyText}</p>;
  return (
    <div className="space-y-1.5">
      {items.slice(0, 6).map((item) => (
        <p key={item} className="text-sm leading-relaxed text-black/55">{item}</p>
      ))}
    </div>
  );
}

function AgentCard({
  id,
  title,
  status,
  meta,
  expanded,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  status: string;
  meta: string;
  expanded: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="border border-black/10">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-black/[0.02]"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-1 text-xs text-black/40">{meta}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <StatusPill status={status} />
          <span className="text-sm text-black/35">{expanded ? '−' : '+'}</span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-black/8 px-4 py-4">
          {children}
          <button
            type="button"
            disabled
            className="mt-4 border border-black/10 px-3 py-1.5 text-xs text-black/30"
          >
            Re-run later
          </button>
        </div>
      )}
    </div>
  );
}

export default function PTProgrammeReviewView({
  run,
  steps,
  retrievalLogs,
  reviewOutputs,
}: {
  run: PTProgramGenerationRun;
  steps: PTProgramGenerationStep[];
  retrievalLogs: PTKnowledgeRetrievalLog[];
  reviewOutputs: PTProgramReviewOutput[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [status, setStatus] = useState('');
  const [updating, setUpdating] = useState(false);
  const [outputs, setOutputs] = useState(reviewOutputs);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({
    client: true,
    methodology: true,
    synthesis: true,
    validation: true,
  });

  const client = run.pt_clients as { name: string; email: string; goals?: string | null } | null;
  const assignment = run.pt_program_assignments as { id: string; name: string; goal: string | null } | null;
  const validationSummary = run.validation_summary ?? {};
  const failures = [
    ...stringArray(validationSummary.hard_failures),
    ...stringArray(validationSummary.hard_rule_failures),
  ];
  const findings = stringArray(validationSummary.findings);
  const missingExercises = stringArray(validationSummary.missing_exercises);
  const passed = validationSummary.passed === true;
  const coachingReasoning = asRecord(run.coaching_reasoning);
  const clientAnalysis = asRecord(coachingReasoning.client_analysis);
  const methodologyPlan = asRecord(coachingReasoning.methodology_plan);
  const analysisGoals = asRecord(clientAnalysis.goals);
  const analysisConstraints = asRecord(clientAnalysis.constraints);
  const analysisPreferences = asRecord(clientAnalysis.preferences);
  const analysisEmphasis = asRecord(clientAnalysis.emphasis);
  const methodologyPhases = asArray(methodologyPlan.phases).map(asRecord);
  const citedDocuments = [
    ...stringArray(methodologyPlan.cited_documents),
    ...stringArray(validationSummary.cited_documents),
  ];
  const synthesisSteps = steps.filter((step) => step.command_name.startsWith('PROGRAMME_SYNTHESIS_'));
  const unresolvedCount = synthesisSteps.reduce((sum, step) => sum + numberValue(asRecord(step.output_json).unresolved_count), 0);
  const totalExercises = countExercises(run);
  const roadmap = asArray(run.phase_roadmap).map(asRecord);
  const nutrition = asArray(run.nutrition_draft).map(asRecord);
  const retrievedDocs = useMemo(() => {
    const docs = retrievalLogs.flatMap((log) => asArray(log.referenced_documents).map(asRecord));
    const byTitle = new Map<string, Record<string, unknown>>();
    for (const doc of docs) {
      const title = text(doc.title);
      if (title && !byTitle.has(title)) byTitle.set(title, doc);
    }
    return [...byTitle.values()];
  }, [retrievalLogs]);
  const referencedTitles = retrievedDocs.map((doc) => text(doc.title)).filter(Boolean);

  const toggleCard = (id: string) => {
    setExpandedCards((cur) => ({ ...cur, [id]: !cur[id] }));
  };

  const openDraft = () => {
    const draftKey = `pt-programme-review:${run.id}:${Date.now()}`;
    const isRevision = Boolean(run.assignment_id);
    sessionStorage.setItem(draftKey, JSON.stringify({
      mode: isRevision ? 'revise_programme' : 'new_programme',
      run_id: run.id,
      client_id: run.client_id,
      assignment_id: run.assignment_id,
      name: assignment?.name ?? `${client?.name ?? 'Client'} Programme`,
      goal: assignment?.goal ?? run.client_goal ?? client?.goals ?? '',
      change_summary: failures.length > 0
        ? `Validation failed. Repair ${failures.length} hard issue${failures.length === 1 ? '' : 's'} before saving.`
        : 'AI draft ready for coach review.',
      validation_summary: run.validation_summary,
      phase_nutrition: nutrition,
      programme: run.programme_draft,
    }));

    if (isRevision && run.assignment_id) {
      router.push(`/dashboard/pt/programmes/${run.assignment_id}/edit?draftKey=${encodeURIComponent(draftKey)}`);
    } else {
      router.push(`/dashboard/pt/programmes/new?draftKey=${encodeURIComponent(draftKey)}`);
    }
  };

  const approveOutput = async (outputId: string) => {
    setUpdating(true);
    const { error } = await supabase
      .from('pt_program_review_outputs')
      .update({ status: 'approved' })
      .eq('id', outputId);
    if (!error) {
      setOutputs((cur) => cur.map((o) => o.id === outputId ? { ...o, status: 'approved' } : o));
    }
    setUpdating(false);
  };

  const updateRunStatus = async (nextStatus: 'approved' | 'needs_review' | 'archived') => {
    setUpdating(true);
    setStatus('Updating review status...');
    const { error } = await supabase
      .from('pt_program_generation_runs')
      .update({
        status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', run.id);
    if (error) {
      setStatus(`Error: ${error.message}`);
      setUpdating(false);
      return;
    }
    setStatus(nextStatus === 'approved' ? 'Marked approved. Open the draft and save it to apply.' : 'Review status updated.');
    router.refresh();
    setUpdating(false);
  };

  return (
    <div className="max-w-5xl px-5 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <Link href="/dashboard/pt/programmes" className="text-sm text-black/30 transition-colors hover:text-black">
          ← Programmes
        </Link>
        <span className="text-black/20">/</span>
        <span className="text-sm text-black/50">Coach review</span>
      </div>

      <div className="mb-8 grid gap-5 lg:grid-cols-[1fr_280px] lg:items-start">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <StatusPill status={run.status} />
            {failures.length > 0 && <StatusPill status="failed" />}
          </div>
          <h1 className="font-display text-3xl font-light tracking-[-0.02em]">
            {client?.name ?? 'Client'} programme review
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-black/50">
            Review the generated draft, retrieval evidence, validation notes, and command trail before opening it in the editor.
          </p>
        </div>
        <div className="border-y border-black/10 py-4 lg:border lg:px-4">
          <p className="text-[0.58rem] uppercase tracking-[0.18em] text-black/35">Run</p>
          <p className="mt-2 break-all text-xs text-black/45">{run.id}</p>
          <p className="mt-2 text-xs text-black/35">
            {new Date(run.created_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>
      </div>

      <div className="mb-8 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={openDraft}
          className="border border-black bg-black px-5 py-2.5 text-sm text-white transition-colors hover:bg-white hover:text-black"
        >
          Open draft in editor
        </button>
        <button
          type="button"
          onClick={() => void updateRunStatus('approved')}
          disabled={updating || failures.length > 0}
          className="border border-black/20 px-5 py-2.5 text-sm transition-colors hover:border-black/40 disabled:opacity-30"
        >
          Approve & save review
        </button>
        <button
          type="button"
          onClick={() => void updateRunStatus('archived')}
          disabled={updating}
          className="border border-black/10 px-5 py-2.5 text-sm text-black/45 transition-colors hover:border-black/25 hover:text-black disabled:opacity-30"
        >
          Archive
        </button>
        {status && <p className="self-center text-xs text-black/45">{status}</p>}
      </div>

      <section className="mb-8">
        <p className="mb-4 text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Agent breakdown</p>
        <div className="space-y-3">
          <AgentCard
            id="client"
            title="Client Analysis"
            status={Object.keys(clientAnalysis).length > 0 ? 'succeeded' : 'needs_review'}
            meta={firstString(analysisGoals.primary, client?.goals, run.client_goal) || 'Client goals and constraints'}
            expanded={expandedCards.client ?? false}
            onToggle={toggleCard}
          >
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <p className="mb-2 text-[0.6rem] uppercase tracking-[0.15em] text-black/35">Goals</p>
                <DetailList
                  items={[
                    firstString(analysisGoals.primary, client?.goals),
                    firstString(analysisGoals.secondary),
                    firstString(analysisGoals.emotional_drivers),
                    firstString(analysisGoals.timeline),
                  ].filter(Boolean)}
                  emptyText="No client goals captured."
                />
              </div>
              <div>
                <p className="mb-2 text-[0.6rem] uppercase tracking-[0.15em] text-black/35">Constraints</p>
                <DetailList
                  items={[
                    ...stringArray(analysisConstraints.injuries),
                    ...stringArray(analysisConstraints.mobility_restrictions),
                    firstString(analysisConstraints.schedule),
                    firstString(analysisConstraints.equipment),
                  ].filter(Boolean)}
                  emptyText="No constraints captured."
                />
              </div>
              <div>
                <p className="mb-2 text-[0.6rem] uppercase tracking-[0.15em] text-black/35">Preferences</p>
                <DetailList
                  items={[
                    ...stringArray(analysisPreferences.exercise_likes),
                    ...stringArray(analysisPreferences.exercise_dislikes).map((item) => `Avoid: ${item}`),
                    firstString(analysisPreferences.training_history),
                  ]}
                  emptyText="No preferences captured."
                />
              </div>
              <div>
                <p className="mb-2 text-[0.6rem] uppercase tracking-[0.15em] text-black/35">Emphasis</p>
                <DetailList
                  items={[
                    firstString(analysisEmphasis.priority),
                    analysisEmphasis.needs_cardio_block === true ? 'Cardio block required' : '',
                    analysisEmphasis.needs_mobility_block === true ? 'Mobility block required' : '',
                    firstString(analysisEmphasis.compound_readiness) ? `Compound readiness: ${firstString(analysisEmphasis.compound_readiness)}` : '',
                  ].filter(Boolean)}
                  emptyText="No emphasis flags captured."
                />
              </div>
            </div>
          </AgentCard>

          <AgentCard
            id="methodology"
            title="Methodology Plan"
            status={methodologyPhases.length > 0 ? 'succeeded' : 'needs_review'}
            meta={`${methodologyPhases.length} planned phase${methodologyPhases.length === 1 ? '' : 's'}`}
            expanded={expandedCards.methodology ?? false}
            onToggle={toggleCard}
          >
            <div className="space-y-4">
              {methodologyPhases.map((phase, index) => (
                <div key={`${text(phase.type, 'phase')}-${index}`} className="border-y border-black/8 py-3 first:border-t-0 last:border-b-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-medium">{text(phase.type, `Phase ${index + 1}`).replace(/_/g, ' ')}</p>
                    <p className="text-xs text-black/35">{String(phase.weeks ?? '?')} week{String(phase.weeks ?? '') === '1' ? '' : 's'}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {asArray(phase.week_blocks).map((block, blockIndex) => {
                      const record = asRecord(block);
                      return (
                        <span key={`${index}-${blockIndex}`} className="border border-black/10 px-2 py-1 text-[0.65rem] text-black/50">
                          {String(record.weeks ?? '?')}w
                          {record.sets ? ` · ${String(record.sets)} sets` : ''}
                          {record.weight_pct ? ` · ${String(record.weight_pct)}` : ''}
                        </span>
                      );
                    })}
                  </div>
                  {text(phase.coaching_notes) && <p className="mt-2 text-sm leading-relaxed text-black/50">{text(phase.coaching_notes)}</p>}
                </div>
              ))}
              <div>
                <p className="mb-2 text-[0.6rem] uppercase tracking-[0.15em] text-black/35">Cited documents</p>
                <DetailList
                  items={Array.from(new Set([...citedDocuments, ...referencedTitles])).slice(0, 10)}
                  emptyText="No cited documents recorded."
                />
              </div>
            </div>
          </AgentCard>

          <AgentCard
            id="synthesis"
            title="Programme Synthesis"
            status={missingExercises.length === 0 && unresolvedCount === 0 ? 'succeeded' : 'needs_review'}
            meta={`${run.programme_draft.phases.length} phases · ${totalExercises} exercises`}
            expanded={expandedCards.synthesis ?? false}
            onToggle={toggleCard}
          >
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <p className="text-2xl font-light">{run.programme_draft.phases.length}</p>
                <p className="text-xs text-black/40">phases</p>
              </div>
              <div>
                <p className="text-2xl font-light">{totalExercises}</p>
                <p className="text-xs text-black/40">exercise objects</p>
              </div>
              <div>
                <p className="text-2xl font-light">{unresolvedCount}</p>
                <p className="text-xs text-black/40">unresolved links</p>
              </div>
            </div>
            <div className="mt-4">
              <p className="mb-2 text-[0.6rem] uppercase tracking-[0.15em] text-black/35">Missing exercises</p>
              <DetailList items={missingExercises} emptyText="No missing exercises." />
            </div>
            <div className="mt-4">
              <p className="mb-2 text-[0.6rem] uppercase tracking-[0.15em] text-black/35">Phase steps</p>
              <div className="space-y-1.5">
                {synthesisSteps.map((step) => (
                  <p key={step.id} className="text-sm text-black/50">{step.step_order}. {step.command_name.replace('PROGRAMME_SYNTHESIS_', '').replace(/_/g, ' ')}</p>
                ))}
              </div>
            </div>
          </AgentCard>

          <AgentCard
            id="validation"
            title="Validation"
            status={passed && failures.length === 0 ? 'succeeded' : failures.length > 0 ? 'failed' : 'needs_review'}
            meta={failures.length > 0 ? `${failures.length} hard issue${failures.length === 1 ? '' : 's'}` : `${findings.length} finding${findings.length === 1 ? '' : 's'}`}
            expanded={expandedCards.validation ?? false}
            onToggle={toggleCard}
          >
            {passed && failures.length === 0 && findings.length === 0 && (
              <p className="border border-green-100 bg-green-50 px-3 py-2 text-sm text-green-700">Validation passed cleanly.</p>
            )}
            {failures.length > 0 && (
              <div className="mb-4">
                <p className="mb-2 text-xs font-medium text-red-600">Hard failures</p>
                <div className="space-y-2">
                  {failures.map((failure) => (
                    <p key={failure} className="border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{failure}</p>
                  ))}
                </div>
              </div>
            )}
            {findings.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-amber-700">Findings</p>
                <div className="space-y-2">
                  {findings.map((finding) => (
                    <p key={finding} className="border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">{finding}</p>
                  ))}
                </div>
              </div>
            )}
          </AgentCard>
        </div>
      </section>

      {(failures.length > 0 || findings.length > 0) && (
        <section className="mb-8 border-y border-black/10 py-5">
          <p className="mb-4 text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Validation</p>
          {failures.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-xs font-medium text-red-600">Hard issues</p>
              <div className="space-y-2">
                {failures.map((failure) => (
                  <p key={failure} className="border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{failure}</p>
                ))}
              </div>
            </div>
          )}
          {findings.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-amber-700">Review notes</p>
              <div className="space-y-2">
                {findings.map((finding) => (
                  <p key={finding} className="border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">{finding}</p>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <section className="mb-8 grid gap-4 lg:grid-cols-3">
        <div className="border-y border-black/10 py-4 lg:border lg:px-4">
          <p className="text-[0.58rem] uppercase tracking-[0.18em] text-black/35">Programme</p>
          <p className="mt-3 text-2xl font-light">{run.programme_draft.phases.length}</p>
          <p className="text-xs text-black/40">phase{run.programme_draft.phases.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="border-y border-black/10 py-4 lg:border lg:px-4">
          <p className="text-[0.58rem] uppercase tracking-[0.18em] text-black/35">Retrieval</p>
          <p className="mt-3 text-2xl font-light">{retrievalLogs.length}</p>
          <p className="text-xs text-black/40">logged search{retrievalLogs.length !== 1 ? 'es' : ''}</p>
        </div>
        <div className="border-y border-black/10 py-4 lg:border lg:px-4">
          <p className="text-[0.58rem] uppercase tracking-[0.18em] text-black/35">Review agents</p>
          <p className="mt-3 text-2xl font-light">{reviewOutputs.length}</p>
          <p className="text-xs text-black/40">outputs</p>
        </div>
      </section>

      {roadmap.length > 0 && (
        <section className="mb-8">
          <p className="mb-4 text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Phase roadmap</p>
          <div className="divide-y divide-black/8 border-y border-black/10">
            {roadmap.map((phase, index) => (
              <div key={`${text(phase.phase_title, 'phase')}-${index}`} className="grid gap-2 py-3 sm:grid-cols-[180px_1fr]">
                <p className="text-sm font-medium">{text(phase.phase_title, `Phase ${index + 1}`)}</p>
                <p className="text-sm leading-relaxed text-black/50">{text(phase.purpose) || text(phase.progression) || text(phase.phase_type)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mb-8">
        <p className="mb-4 text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Evidence</p>
        <div className="border-y border-black/10 py-4 lg:border lg:px-4">
          <p className="text-xs font-medium text-black/60">Referenced documents</p>
          <div className="mt-3 space-y-2">
            {retrievedDocs.length > 0 ? retrievedDocs.map((doc) => (
              <p key={text(doc.title)} className="text-sm text-black/50">{text(doc.title)}</p>
            )) : <p className="text-sm text-black/35">No referenced documents recorded.</p>}
          </div>
        </div>
      </section>

      <section className="mb-8">
        <p className="mb-4 text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Review outputs</p>
        <div className="space-y-3">
          {outputs.map((output) => {
            const approved = output.status === 'approved';
            const outputFailures = asArray(output.hard_rule_failures).map(String);
            const outputFindings = asArray(output.findings).map(String);
            return (
              <div key={output.id} className={`border ${approved ? 'border-green-200' : outputFailures.length > 0 ? 'border-red-200' : 'border-black/10'}`}>
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    {approved && <span className="text-green-600 text-xs font-medium">✓</span>}
                    <p className="text-sm font-medium capitalize">{output.review_type}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusPill status={output.status} />
                    {!approved && (
                      <button
                        type="button"
                        onClick={() => void approveOutput(output.id)}
                        disabled={updating}
                        className="text-xs border border-green-600 text-green-700 px-3 py-1 hover:bg-green-50 disabled:opacity-40 transition-colors"
                      >
                        Approve
                      </button>
                    )}
                  </div>
                </div>
                {(outputFailures.length > 0 || outputFindings.length > 0) && (
                  <div className="border-t border-black/8 px-4 pb-4 pt-3 space-y-3">
                    {outputFailures.length > 0 && (
                      <div>
                        <p className="text-[0.6rem] uppercase tracking-[0.15em] text-red-500 mb-2">Hard failures</p>
                        <div className="space-y-1.5">
                          {outputFailures.map((f) => (
                            <p key={f} className="text-xs text-red-700 bg-red-50 border border-red-100 px-3 py-1.5">{f}</p>
                          ))}
                        </div>
                      </div>
                    )}
                    {outputFindings.length > 0 && (
                      <div>
                        <p className="text-[0.6rem] uppercase tracking-[0.15em] text-amber-600 mb-2">Findings</p>
                        <div className="space-y-1.5">
                          {outputFindings.map((f) => (
                            <p key={f} className="text-xs text-amber-800 bg-amber-50 border border-amber-100 px-3 py-1.5">{f}</p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {outputs.length === 0 && (
            <p className="text-sm text-black/35">No review outputs recorded for this run.</p>
          )}
        </div>
      </section>

      {nutrition.length > 0 && (
        <section className="mb-8">
          <p className="mb-4 text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Phase nutrition</p>
          <div className="divide-y divide-black/8 border-y border-black/10">
            {nutrition.map((item, index) => {
              const recommendations = asRecord(item.recommendations);
              return (
                <div key={`${text(item.phase_title, 'phase')}-${index}`} className="grid gap-2 py-3 sm:grid-cols-[180px_1fr]">
                  <p className="text-sm font-medium">{text(item.phase_title, `Phase ${index + 1}`)}</p>
                  <p className="text-sm leading-relaxed text-black/50">
                    {text(recommendations.priority) || text(recommendations.summary) || JSON.stringify(recommendations)}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <p className="mb-4 text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Command trail</p>
        <div className="divide-y divide-black/8 border-y border-black/10">
          {steps.map((step) => (
            <div key={step.id} className="grid gap-2 py-3 sm:grid-cols-[48px_1fr_auto] sm:items-center">
              <p className="text-xs text-black/30">{step.step_order}</p>
              <div>
                <p className="text-sm font-medium">{step.command_name}</p>
                {step.failure_reason && <p className="mt-1 text-xs text-red-600">{step.failure_reason}</p>}
              </div>
              <StatusPill status={step.status} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
