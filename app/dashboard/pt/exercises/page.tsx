import { createClient } from '@/utils/supabase/server';
import type { PTExercise } from '@/utils/pt/types';
import PTExercisesView from './PTExercisesView';

export default async function PTExercisesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('pt_exercises')
    .select('*')
    .order('name');
  const exercises = (data ?? []) as PTExercise[];
  return <PTExercisesView initialExercises={exercises} />;
}
