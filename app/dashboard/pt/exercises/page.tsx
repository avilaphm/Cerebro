import { createClient } from '@/utils/supabase/server';
import { fetchAllPTExercises } from '@/utils/pt/exercise-library';
import PTExercisesView from './PTExercisesView';

export default async function PTExercisesPage() {
  const supabase = await createClient();
  const exercises = await fetchAllPTExercises(supabase);
  return <PTExercisesView initialExercises={exercises} />;
}
