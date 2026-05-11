import { createClient } from '@/utils/supabase/server';
import type { PTClient, PTExercise } from '@/utils/pt/types';
import PTProgrammeWizard from './PTProgrammeWizard';

export default async function NewProgrammePage() {
  const supabase = await createClient();

  const [clientRes, exerciseRes] = await Promise.all([
    supabase.from('pt_clients').select('*').in('status', ['invited', 'active']).order('name'),
    supabase.from('pt_exercises').select('*').order('name').limit(400),
  ]);

  return (
    <PTProgrammeWizard
      clients={(clientRes.data ?? []) as PTClient[]}
      exercises={(exerciseRes.data ?? []) as PTExercise[]}
    />
  );
}
