import { notFound } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { safeProgramme } from '@/utils/pt/programme';
import type { PTProgramAssignment, PTExercise } from '@/utils/pt/types';
import PTProgrammeEditView from './PTProgrammeEditView';

export default async function PTProgrammeEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ note?: string; phase?: string; day?: string; section?: string }>;
}) {
  const { id } = await params;
  const highlight = await searchParams;
  const supabase = await createClient();

  const [assignmentRes, exercisesRes, phaseNutritionRes] = await Promise.all([
    supabase
      .from('pt_program_assignments')
      .select('*, pt_clients(name, email)')
      .eq('id', id)
      .single(),
    supabase.from('pt_exercises').select('*').order('name'),
    supabase
      .from('pt_phase_nutrition')
      .select('*')
      .eq('assignment_id', id)
      .order('phase_index'),
  ]);

  if (assignmentRes.error || !assignmentRes.data) notFound();

  const assignment: PTProgramAssignment = {
    ...assignmentRes.data as PTProgramAssignment,
    programme: safeProgramme((assignmentRes.data as PTProgramAssignment).programme),
    current_week: (assignmentRes.data as PTProgramAssignment).current_week ?? 1,
    current_block_index: (assignmentRes.data as PTProgramAssignment).current_block_index ?? 0,
  };

  const dbPhaseNutrition = phaseNutritionRes.data ?? [];

  // If no DB rows yet and a generation run exists, load nutrition_draft from the run
  let nutritionDraftFromRun: unknown[] | null = null;
  if (dbPhaseNutrition.length === 0 && assignment.generation_run_id) {
    const { data: runData } = await supabase
      .from('pt_program_generation_runs')
      .select('nutrition_draft')
      .eq('id', assignment.generation_run_id)
      .single();
    if (Array.isArray(runData?.nutrition_draft)) {
      nutritionDraftFromRun = runData.nutrition_draft;
    }
  }

  return (
    <PTProgrammeEditView
      assignment={assignment}
      exercises={(exercisesRes.data ?? []) as PTExercise[]}
      highlight={highlight}
      phaseNutrition={dbPhaseNutrition}
      nutritionDraftFromRun={nutritionDraftFromRun}
    />
  );
}
