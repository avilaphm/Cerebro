import { createClient } from '@/utils/supabase/server';
import type { PTProgramTemplate, PTProgramAssignment } from '@/utils/pt/types';
import { safeProgramme } from '@/utils/pt/programme';

export default async function PTProgrammesPage() {
  const supabase = await createClient();

  const [templatesRes, assignmentsRes] = await Promise.all([
    supabase.from('pt_program_templates').select('*').order('updated_at', { ascending: false }),
    supabase
      .from('pt_program_assignments')
      .select('*, pt_clients(name, email)')
      .order('updated_at', { ascending: false }),
  ]);

  const templates = ((templatesRes.data ?? []) as PTProgramTemplate[]).map((t) => ({
    ...t,
    programme: safeProgramme(t.programme),
  }));
  const assignments = ((assignmentsRes.data ?? []) as PTProgramAssignment[]).map((a) => ({
    ...a,
    programme: safeProgramme(a.programme),
  }));

  return (
    <div className="p-8">
      <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-1">PT</p>
      <h1 className="font-display text-3xl font-light tracking-[-0.02em] mb-2">Programmes</h1>
      <p className="text-sm text-black/40 mb-8">AI programme builder coming in Phase 4. Existing templates and assignments below.</p>

      {templates.length > 0 && (
        <section className="mb-10">
          <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-4">Templates</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((t) => (
              <div key={t.id} className="border border-black/10 p-5">
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
              </div>
            ))}
          </div>
        </section>
      )}

      {assignments.length > 0 && (
        <section>
          <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-4">Client assignments</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {assignments.map((a) => {
              const cl = a.pt_clients as { name: string; email: string } | null;
              return (
                <div key={a.id} className="border border-black/10 p-5">
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
                </div>
              );
            })}
          </div>
        </section>
      )}

      {templates.length === 0 && assignments.length === 0 && (
        <p className="text-sm text-black/30">No programmes yet. The full AI builder is coming in Phase 4.</p>
      )}
    </div>
  );
}
