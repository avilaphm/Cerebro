'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import type { PTProgramme } from '@/utils/pt/types';

interface Template {
  id: string;
  name: string;
  goal: string | null;
  duration_weeks: number | null;
  phase_count: number | null;
  programme: PTProgramme;
}

interface Assignment {
  id: string;
  name: string;
  goal: string | null;
  status: string;
  programme: PTProgramme;
  pt_clients: { name: string; email: string } | null;
}

interface ReviewRun {
  id: string;
  status: string;
  task_type: string;
  current_command: string | null;
  created_at: string;
  validation_summary: { hard_rule_failures?: unknown[]; findings?: unknown[] } | null;
  programme_draft: PTProgramme;
  pt_clients: { name: string; email: string; goals?: string | null } | null;
}

type DeleteState = 'idle' | 'confirm' | 'deleting';

export default function PTProgrammesView({
  templates,
  assignments,
  reviewRuns,
}: {
  templates: Template[];
  assignments: Assignment[];
  reviewRuns: ReviewRun[];
}) {
  const supabase = createClient();
  const router = useRouter();

  const [templateDeleteState, setTemplateDeleteState] = useState<Record<string, DeleteState>>({});
  const [assignmentDeleteState, setAssignmentDeleteState] = useState<Record<string, DeleteState>>({});
  const [localTemplates, setLocalTemplates] = useState(templates);
  const [localAssignments, setLocalAssignments] = useState(assignments);

  const deleteTemplate = async (id: string) => {
    const state = templateDeleteState[id] ?? 'idle';
    if (state === 'idle') {
      setTemplateDeleteState((prev) => ({ ...prev, [id]: 'confirm' }));
      return;
    }
    if (state === 'confirm') {
      setTemplateDeleteState((prev) => ({ ...prev, [id]: 'deleting' }));
      const { error } = await supabase.from('pt_program_templates').delete().eq('id', id);
      if (error) {
        setTemplateDeleteState((prev) => ({ ...prev, [id]: 'confirm' }));
        return;
      }
      setLocalTemplates((prev) => prev.filter((t) => t.id !== id));
      setTemplateDeleteState((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      router.refresh();
    }
  };

  const cancelTemplateDelete = (id: string) => {
    setTemplateDeleteState((prev) => ({ ...prev, [id]: 'idle' }));
  };

  const deleteAssignment = async (id: string) => {
    const state = assignmentDeleteState[id] ?? 'idle';
    if (state === 'idle') {
      setAssignmentDeleteState((prev) => ({ ...prev, [id]: 'confirm' }));
      return;
    }
    if (state === 'confirm') {
      setAssignmentDeleteState((prev) => ({ ...prev, [id]: 'deleting' }));
      const { error } = await supabase.from('pt_program_assignments').delete().eq('id', id);
      if (error) {
        setAssignmentDeleteState((prev) => ({ ...prev, [id]: 'confirm' }));
        return;
      }
      setLocalAssignments((prev) => prev.filter((a) => a.id !== id));
      setAssignmentDeleteState((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      router.refresh();
    }
  };

  const cancelAssignmentDelete = (id: string) => {
    setAssignmentDeleteState((prev) => ({ ...prev, [id]: 'idle' }));
  };

  return (
    <div className="px-5 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <div className="mb-8 flex flex-col gap-4 sm:mb-10 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-1">PT</p>
          <h1 className="font-display text-3xl font-light tracking-[-0.02em]">PTProgrammes</h1>
        </div>
        <Link
          href="/dashboard/pt/programmes/new"
          className="w-full border border-black bg-black px-5 py-3 text-center text-sm text-white transition-colors hover:bg-white hover:text-black sm:w-auto sm:py-2.5"
        >
          + New programme
        </Link>
      </div>

      {reviewRuns.length > 0 && (
        <section className="mb-10">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Coach review queue</h2>
              <p className="mt-1 text-xs text-black/40">Generated drafts waiting for review, repair, or approval.</p>
            </div>
          </div>
          <div className="divide-y divide-black/8 border-y border-black/10">
            {reviewRuns.map((run) => {
              const client = run.pt_clients;
              const failures = Array.isArray(run.validation_summary?.hard_rule_failures)
                ? run.validation_summary.hard_rule_failures.length
                : 0;
              const findings = Array.isArray(run.validation_summary?.findings)
                ? run.validation_summary.findings.length
                : 0;
              return (
                <Link
                  key={run.id}
                  href={`/dashboard/pt/programmes/review/${run.id}`}
                  className="grid gap-3 px-1 py-4 transition-colors hover:bg-black/[0.02] sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{client?.name ?? 'Client programme'}</p>
                      <span className={`border px-2 py-0.5 text-[0.58rem] uppercase tracking-[0.12em] ${
                        run.status === 'failed'
                          ? 'border-red-200 bg-red-50 text-red-600'
                          : run.status === 'running'
                            ? 'border-blue-200 bg-blue-50 text-blue-600'
                            : 'border-amber-200 bg-amber-50 text-amber-700'
                      }`}>
                        {run.status.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-black/40">
                      {run.task_type.replace('_', ' ')} · {run.current_command ?? 'Review'} · {new Date(run.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                  <p className="text-xs text-black/40">
                    {run.programme_draft.phases.length} phase{run.programme_draft.phases.length !== 1 ? 's' : ''} · {failures} hard issue{failures !== 1 ? 's' : ''} · {findings} note{findings !== 1 ? 's' : ''}
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {localTemplates.length > 0 && (
        <section className="mb-10">
          <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-4">Templates</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
            {localTemplates.map((t) => {
              const ds = templateDeleteState[t.id] ?? 'idle';
              return (
                <div key={t.id} className={`relative border transition-colors ${ds === 'confirm' ? 'border-red-200 bg-red-50/30' : 'border-black/10 hover:border-black/20'}`}>
                  {ds !== 'confirm' && ds !== 'deleting' && (
                    <Link href={`/dashboard/pt/programmes/template/${t.id}`} className="block p-5">
                      <p className="font-medium text-sm pr-6">{t.name}</p>
                      {t.goal && <p className="text-xs text-black/40 mt-0.5">{t.goal}</p>}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {t.programme.phases.map((ph) => (
                          <span key={ph.id} className="text-[0.6rem] uppercase tracking-[0.1em] border border-black/10 px-2 py-0.5 text-black/50">
                            {ph.title} · {ph.weeks}w
                          </span>
                        ))}
                      </div>
                      <p className="text-xs text-black/30 mt-3">{t.duration_weeks} weeks · {t.phase_count} phases</p>
                    </Link>
                  )}

                  {ds === 'confirm' && (
                    <div className="p-5">
                      <p className="font-medium text-sm pr-6">{t.name}</p>
                      {t.goal && <p className="text-xs text-black/40 mt-0.5">{t.goal}</p>}
                      <div className="mt-4 border-t border-red-200 pt-4">
                        <p className="text-xs font-medium text-red-700 mb-3">Delete this template?</p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => void deleteTemplate(t.id)}
                            className="flex-1 border border-red-500 bg-red-500 text-white px-3 py-2 text-xs hover:bg-red-600 transition-colors"
                          >
                            Yes, delete
                          </button>
                          <button
                            onClick={() => cancelTemplateDelete(t.id)}
                            className="flex-1 border border-black/20 px-3 py-2 text-xs hover:border-black/40 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {ds === 'deleting' && (
                    <div className="p-5">
                      <p className="font-medium text-sm text-black/40">{t.name}</p>
                      <p className="text-xs text-black/30 mt-2">Deleting...</p>
                    </div>
                  )}

                  {ds === 'idle' && (
                    <button
                      onClick={() => void deleteTemplate(t.id)}
                      className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center text-black/20 hover:text-red-500 transition-colors"
                      aria-label="Delete template"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 10L10 2M2 2l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {localAssignments.length > 0 && (
        <section>
          <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-4">Client assignments</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
            {localAssignments.map((a) => {
              const cl = a.pt_clients;
              const ds = assignmentDeleteState[a.id] ?? 'idle';
              return (
                <div key={a.id} className={`relative border transition-colors ${ds === 'confirm' ? 'border-red-200 bg-red-50/30' : 'border-black/10 hover:border-black/20'}`}>
                  {ds !== 'confirm' && ds !== 'deleting' && (
                    <Link href={`/dashboard/pt/programmes/${a.id}/edit`} className="block p-5">
                      <div className="flex items-start justify-between mb-2 pr-6">
                        <p className="font-medium text-sm">{a.name}</p>
                        <span className={`shrink-0 text-[0.6rem] uppercase tracking-[0.1em] px-2 py-0.5 border rounded-full ${
                          a.status === 'active' ? 'border-green-300 bg-green-50 text-green-700' : 'border-black/10 text-black/40'
                        }`}>{a.status}</span>
                      </div>
                      {cl && <p className="text-xs text-black/40">{cl.name}</p>}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {a.programme.phases.map((ph) => (
                          <span key={ph.id} className="text-[0.6rem] uppercase tracking-[0.1em] border border-black/10 px-2 py-0.5 text-black/50">
                            {ph.title} · {ph.weeks}w
                          </span>
                        ))}
                      </div>
                    </Link>
                  )}

                  {ds === 'confirm' && (
                    <div className="p-5">
                      <div className="flex items-start justify-between mb-1">
                        <p className="font-medium text-sm">{a.name}</p>
                        <span className={`shrink-0 text-[0.6rem] uppercase tracking-[0.1em] px-2 py-0.5 border rounded-full ${
                          a.status === 'active' ? 'border-green-300 bg-green-50 text-green-700' : 'border-black/10 text-black/40'
                        }`}>{a.status}</span>
                      </div>
                      {cl && <p className="text-xs text-black/40">{cl.name}</p>}
                      <div className="mt-4 border-t border-red-200 pt-4">
                        <p className="text-xs font-medium text-red-700 mb-1">Delete this programme?</p>
                        <p className="text-[0.65rem] text-red-500/70 mb-3">Workout logs and set data will also be removed.</p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => void deleteAssignment(a.id)}
                            className="flex-1 border border-red-500 bg-red-500 text-white px-3 py-2 text-xs hover:bg-red-600 transition-colors"
                          >
                            Yes, delete
                          </button>
                          <button
                            onClick={() => cancelAssignmentDelete(a.id)}
                            className="flex-1 border border-black/20 px-3 py-2 text-xs hover:border-black/40 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {ds === 'deleting' && (
                    <div className="p-5">
                      <p className="font-medium text-sm text-black/40">{a.name}</p>
                      {cl && <p className="text-xs text-black/30">{cl.name}</p>}
                      <p className="text-xs text-black/30 mt-2">Deleting...</p>
                    </div>
                  )}

                  {ds === 'idle' && (
                    <button
                      onClick={() => void deleteAssignment(a.id)}
                      className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center text-black/20 hover:text-red-500 transition-colors"
                      aria-label="Delete programme"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 10L10 2M2 2l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {localTemplates.length === 0 && localAssignments.length === 0 && (
        <div className="text-center py-16">
          <p className="text-sm text-black/30 mb-4">No programmes yet.</p>
          <Link href="/dashboard/pt/programmes/new" className="border border-black bg-black text-white px-5 py-2.5 text-sm hover:bg-white hover:text-black transition-colors">
            Create your first programme
          </Link>
        </div>
      )}
    </div>
  );
}
