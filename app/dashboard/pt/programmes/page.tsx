import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';
import type { PTProgramTemplate, PTProgramAssignment, PTProgramGenerationRun } from '@/utils/pt/types';
import { safeProgramme } from '@/utils/pt/programme';

export default async function PTProgrammesPage() {
  const supabase = await createClient();

  const [templatesRes, assignmentsRes, reviewRunsRes] = await Promise.all([
    supabase.from('pt_program_templates').select('*').order('updated_at', { ascending: false }),
    supabase
      .from('pt_program_assignments')
      .select('*, pt_clients(name, email)')
      .order('updated_at', { ascending: false }),
    supabase
      .from('pt_program_generation_runs')
      .select('*, pt_clients(name, email, goals), pt_program_assignments(id, name, goal)')
      .in('status', ['needs_review', 'failed', 'running'])
      .order('created_at', { ascending: false })
      .limit(12),
  ]);

  const templates = ((templatesRes.data ?? []) as PTProgramTemplate[]).map((t) => ({
    ...t,
    programme: safeProgramme(t.programme),
  }));
  const assignments = ((assignmentsRes.data ?? []) as PTProgramAssignment[]).map((a) => ({
    ...a,
    programme: safeProgramme(a.programme),
  }));
  const reviewRuns = ((reviewRunsRes.data ?? []) as PTProgramGenerationRun[]).map((run) => ({
    ...run,
    programme_draft: safeProgramme(run.programme_draft),
  }));

  return (
    <div className="px-5 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <div className="mb-8 flex flex-col gap-4 sm:mb-10 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-1">PT</p>
          <h1 className="font-display text-3xl font-light tracking-[-0.02em]">Programmes</h1>
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
              <p className="mt-1 text-xs text-black/40">Generated drafts waiting for Pedro&apos;s review, repair, or approval.</p>
            </div>
          </div>
          <div className="divide-y divide-black/8 border-y border-black/10">
            {reviewRuns.map((run) => {
              const client = run.pt_clients as { name: string; email: string; goals?: string | null } | null;
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

      {templates.length > 0 && (
        <section className="mb-10">
          <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-4">Templates</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
            {templates.map((t) => (
              <Link key={t.id} href={`/dashboard/pt/programmes/template/${t.id}`} className="block border border-black/10 p-5 hover:border-black/30 transition-colors">
                <p className="font-medium text-sm">{t.name}</p>
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
            ))}
          </div>
        </section>
      )}

      {assignments.length > 0 && (
        <section>
          <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-4">Client assignments</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
            {assignments.map((a) => {
              const cl = a.pt_clients as { name: string; email: string } | null;
              return (
                <Link key={a.id} href={`/dashboard/pt/programmes/${a.id}/edit`} className="block border border-black/10 p-5 hover:border-black/30 transition-colors">
                  <div className="flex items-start justify-between mb-2">
                    <p className="font-medium text-sm">{a.name}</p>
                    <span className={`text-[0.6rem] uppercase tracking-[0.1em] px-2 py-0.5 border rounded-full ${
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
              );
            })}
          </div>
        </section>
      )}

      {templates.length === 0 && assignments.length === 0 && (
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
