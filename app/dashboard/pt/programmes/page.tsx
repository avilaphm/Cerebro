import { createClient } from '@/utils/supabase/server';
import type { PTProgramTemplate, PTProgramAssignment, PTProgramGenerationRun } from '@/utils/pt/types';
import { resolveActivePhaseIndex, safeProgramme, type ProgrammeProgressWorkoutLog } from '@/utils/pt/programme';
import PTProgrammesView from './PTProgrammesView';

export default async function PTProgrammesPage() {
  const supabase = await createClient();

  const [templatesRes, assignmentsRes, reviewRunsRes] = await Promise.all([
    supabase.from('pt_program_templates').select('*').order('updated_at', { ascending: false }),
    supabase
      .from('pt_program_assignments')
      .select('id, template_id, name, goal, status, programme, current_phase_index, updated_at, pt_clients(name, email), pt_workout_logs(phase_index, day_index, week_number, block_index)')
      .order('updated_at', { ascending: false }),
    supabase
      .from('pt_program_generation_runs')
      .select('*, pt_clients(name, email, goals), pt_program_assignments(id, name, goal)')
      .in('status', ['needs_review', 'failed', 'running'])
      .order('created_at', { ascending: false })
      .limit(12),
  ]);

  const templates = ((templatesRes.data ?? []) as PTProgramTemplate[]).map((t) => ({
    id: t.id,
    name: t.name,
    goal: t.goal ?? null,
    duration_weeks: t.duration_weeks ?? null,
    phase_count: t.phase_count ?? null,
    programme: safeProgramme(t.programme),
  }));

  const assignments = ((assignmentsRes.data ?? []) as unknown as Array<PTProgramAssignment & { pt_workout_logs?: ProgrammeProgressWorkoutLog[] }>).map((a) => {
    const programme = safeProgramme(a.programme);
    const currentPhaseIndex = resolveActivePhaseIndex(programme, a.pt_workout_logs ?? [], a.current_phase_index);
    return {
      id: a.id,
      template_id: a.template_id ?? null,
      name: a.name,
      goal: a.goal ?? null,
      status: a.status,
      programme,
      current_phase_title: programme.phases[currentPhaseIndex]?.title ?? 'Not started',
      pt_clients: (a.pt_clients as { name: string; email: string } | null) ?? null,
    };
  });

  const reviewRuns = ((reviewRunsRes.data ?? []) as PTProgramGenerationRun[]).map((run) => {
    const assignmentJoin = (run as unknown as { pt_program_assignments?: unknown }).pt_program_assignments;
    const saved = Array.isArray(assignmentJoin) ? assignmentJoin.length > 0 : Boolean(assignmentJoin);
    return {
      id: run.id,
      status: run.status,
      task_type: run.task_type,
      current_command: run.current_command ?? null,
      created_at: run.created_at,
      saved,
      validation_summary: (run.validation_summary as { hard_rule_failures?: unknown[]; findings?: unknown[] } | null) ?? null,
      programme_draft: safeProgramme(run.programme_draft),
      pt_clients: (run.pt_clients as { name: string; email: string; goals?: string | null } | null) ?? null,
    };
  });

  return (
    <PTProgrammesView
      templates={templates}
      assignments={assignments}
      reviewRuns={reviewRuns}
    />
  );
}
