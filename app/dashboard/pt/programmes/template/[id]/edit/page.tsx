import { notFound } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { safeProgramme } from '@/utils/pt/programme';
import { fetchAllPTExercises } from '@/utils/pt/exercise-library';
import type { PTProgramTemplate, PTExercise } from '@/utils/pt/types';
import PTProgrammeTemplateEditView from './PTProgrammeTemplateEditView';

export default async function PTProgrammeTemplateEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [templateRes, exercisesRes] = await Promise.all([
    supabase.from('pt_program_templates').select('*').eq('id', id).single(),
    fetchAllPTExercises(supabase),
  ]);

  if (templateRes.error || !templateRes.data) notFound();

  const template: PTProgramTemplate = {
    ...(templateRes.data as PTProgramTemplate),
    programme: safeProgramme((templateRes.data as PTProgramTemplate).programme),
  };

  return (
    <PTProgrammeTemplateEditView
      template={template}
      exercises={exercisesRes as PTExercise[]}
    />
  );
}
