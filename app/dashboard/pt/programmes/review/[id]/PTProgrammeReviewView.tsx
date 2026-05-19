'use client';

import { useMemo, useState } from 'react';
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

  const client = run.pt_clients as { name: string; email: string; goals?: string | null } | null;
  const assignment = run.pt_program_assignments as { id: string; name: string; goal: string | null } | null;
  const failures = asArray(run.validation_summary?.hard_rule_failures).map((item) => String(item));
  const findings = asArray(run.validation_summary?.findings).map((item) => String(item));
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
          Mark approved
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
