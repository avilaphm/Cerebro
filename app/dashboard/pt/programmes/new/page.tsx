import { createClient } from '@/utils/supabase/server';
import type { PTClient, PTExercise } from '@/utils/pt/types';
import { fetchAllPTExercises } from '@/utils/pt/exercise-library';
import PTProgrammeWizard from './PTProgrammeWizard';

export default async function NewProgrammePage() {
  const supabase = await createClient();

  const [clientRes, exerciseRes] = await Promise.all([
    supabase.from('pt_clients').select('*').in('status', ['invited', 'active']).order('name'),
    fetchAllPTExercises(supabase),
  ]);

  return (
    <PTProgrammeWizard
      clients={(clientRes.data ?? []) as PTClient[]}
      exercises={exerciseRes as PTExercise[]}
    />
  );
}
