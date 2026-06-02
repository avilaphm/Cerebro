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
  template_id: string | null;
  name: string;
  goal: string | null;
  status: string;
  programme: PTProgramme;
  current_phase_title: string;
  pt_clients: { name: string; email: string } | null;
}

interface ReviewRun {
  id: string;
  status: string;
  task_type: string;
  current_command: string | null;
  created_at: string;
  saved: boolean;
  validation_summary: { hard_rule_failures?: unknown[]; findings?: unknown[] } | null;
  programme_draft: PTProgramme;
  pt_clients: { name: string; email: string; goals?: string | null } | null;
}

// Drafts auto-delete 24h after creation (delete_stale_program_drafts cron). Returns a
// short "expires in Xh" / "expires soon" hint, or null once past the window.
function draftExpiryLabel(createdAt: string): string | null {
  const msLeft = new Date(createdAt).getTime() + 24 * 60 * 60 * 1000 - Date.now();
  if (msLeft <= 0) return null;
  const hoursLeft = Math.ceil(msLeft / (60 * 60 * 1000));
  return hoursLeft <= 1 ? 'expires within the hour' : `expires in ${hoursLeft}h`;
}

type DeleteState = 'idle' | 'confirm' | 'deleting';

function AssignmentCardSummary({ assignment }: { assignment: Assignment }) {
  return (
    <>
      <p className="pr-6 text-base font-semibold leading-tight text-black">
        {assignment.pt_clients?.name ?? 'Unassigned client'}
      </p>
      <p className="mt-2 text-sm leading-snug text-black/65">{assignment.name}</p>
      <span className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.1em] ${
        assignment.status === 'active' ? 'border-green-300 bg-green-50 text-green-700' : 'border-black/10 text-black/40'
      }`}>
        {assignment.status}
      </span>
      <div className="mt-4 border-t border-black/8 pt-3">
        <p className="text-[0.58rem] uppercase tracking-[0.16em] text-black/35">Current phase</p>
        <p className="mt-1 text-xs font-medium text-black/65">{assignment.current_phase_title}</p>
      </div>
    </>
  );
}

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
  const [expandedTemplates, setExpandedTemplates] = useState<Record<string, boolean>>({});
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
              <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Drafts &amp; review queue</h2>
              <p className="mt-1 text-xs text-black/40">Generated programmes waiting to be reviewed and saved. Open one to keep editing. Unsaved drafts auto-delete after 24 hours.</p>
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
              const isResumableDraft = !run.saved && (run.status === 'needs_review' || run.status === 'approved');
              const expiry = isResumableDraft ? draftExpiryLabel(run.created_at) : null;
              return (
                <Link
                  key={run.id}
                  href={`/dashboard/pt/programmes/review/${run.id}`}
                  className="grid gap-3 px-1 py-4 transition-colors hover:bg-black/[0.02] sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{client?.name ?? 'Client programme'}</p>
                      {isResumableDraft && (
                        <span className="border border-black/15 bg-black/[0.04] px-2 py-0.5 text-[0.58rem] uppercase tracking-[0.12em] text-black/55">
                          Draft
                        </span>
                      )}
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
                      {expiry && <span className="text-black/30"> · {expiry}</span>}
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

      {localAssignments.length > 0 && (
        <section className="mb-10">
          <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-4">Client programmes</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
            {localAssignments.map((a) => {
              const cl = a.pt_clients;
              const ds = assignmentDeleteState[a.id] ?? 'idle';
              return (
                <div key={a.id} className={`relative border transition-colors ${ds === 'confirm' ? 'border-red-200 bg-red-50/30' : 'border-black/10 hover:border-black/20'}`}>
                  {ds !== 'confirm' && ds !== 'deleting' && (
                    <Link href={`/dashboard/pt/programmes/${a.id}/edit`} className="block p-5">
                      <AssignmentCardSummary assignment={a} />
                    </Link>
                  )}

                  {ds === 'confirm' && (
                    <div className="p-5">
                      <AssignmentCardSummary assignment={a} />
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
                      <p className="text-base font-semibold leading-tight text-black/40">{cl?.name ?? 'Unassigned client'}</p>
                      <p className="mt-2 text-sm text-black/30">{a.name}</p>
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

      {localTemplates.length > 0 && (
        <section>
          <h2 className="mb-4 text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Programme templates</h2>
          <div className="divide-y divide-black/8 border-y border-black/10">
            {localTemplates.map((t) => {
              const ds = templateDeleteState[t.id] ?? 'idle';
              const expanded = expandedTemplates[t.id] ?? false;
              const assignedClients = localAssignments.filter((assignment) =>
                assignment.template_id === t.id && assignment.status !== 'archived'
              );
              return (
                <div key={t.id} className={ds === 'confirm' ? 'bg-red-50/30' : ''}>
                  {ds !== 'deleting' && (
                    <>
                      <button
                        type="button"
                        onClick={() => setExpandedTemplates((prev) => ({ ...prev, [t.id]: !expanded }))}
                        className="flex w-full items-center justify-between gap-4 px-3 py-5 text-left transition-colors hover:bg-black/[0.025] sm:px-4 sm:py-6"
                        aria-expanded={expanded}
                      >
                        <span className="min-w-0">
                          <span className="block text-base font-semibold leading-snug text-black sm:text-lg">{t.name}</span>
                          <span className="mt-1 block text-xs text-black/40">
                            {assignedClients.length} assigned client{assignedClients.length !== 1 ? 's' : ''}
                          </span>
                        </span>
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          fill="none"
                          className={`shrink-0 text-black/35 transition-transform ${expanded ? 'rotate-180' : ''}`}
                          aria-hidden="true"
                        >
                          <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>

                      {expanded && (
                        <div className="px-3 pb-5 sm:px-4 sm:pb-6">
                          {t.goal && <p className="max-w-3xl text-sm leading-relaxed text-black/55">{t.goal}</p>}
                          <div className="mt-4 border-t border-black/8 pt-4">
                            <p className="text-[0.58rem] uppercase tracking-[0.16em] text-black/35">Assigned clients</p>
                            {assignedClients.length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {assignedClients.map((assignment) => (
                                  <span key={assignment.id} className="inline-flex items-center gap-1.5 rounded-full border border-black/10 px-2.5 py-1 text-xs text-black/60">
                                    {assignment.pt_clients?.name ?? 'Unassigned client'}
                                    <span className="text-[0.55rem] uppercase tracking-[0.08em] text-black/35">{assignment.status}</span>
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-2 text-xs text-black/35">No clients currently assigned.</p>
                            )}
                          </div>

                          {ds === 'confirm' ? (
                            <div className="mt-4 border-t border-red-200 pt-4">
                              <p className="mb-3 text-xs font-medium text-red-700">Delete this template?</p>
                              <div className="flex flex-col gap-2 sm:flex-row">
                                <button
                                  onClick={() => void deleteTemplate(t.id)}
                                  className="border border-red-500 bg-red-500 px-4 py-2 text-xs text-white transition-colors hover:bg-red-600"
                                >
                                  Yes, delete
                                </button>
                                <button
                                  onClick={() => cancelTemplateDelete(t.id)}
                                  className="border border-black/20 px-4 py-2 text-xs transition-colors hover:border-black/40"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-5 flex flex-wrap gap-4">
                              <Link href={`/dashboard/pt/programmes/template/${t.id}`} className="text-xs font-medium text-black underline underline-offset-4">
                                Open template
                              </Link>
                              <button
                                onClick={() => void deleteTemplate(t.id)}
                                className="text-xs text-red-500 underline underline-offset-4 transition-colors hover:text-red-700"
                              >
                                Delete template
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {ds === 'deleting' && (
                    <div className="px-3 py-5 sm:px-4 sm:py-6">
                      <p className="text-base font-semibold text-black/40 sm:text-lg">{t.name}</p>
                      <p className="mt-1 text-xs text-black/30">Deleting...</p>
                    </div>
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
