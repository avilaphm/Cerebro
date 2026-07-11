import { createClient } from '@/utils/supabase/server';
import { fetchAllPTExercises } from '@/utils/pt/exercise-library';
import PTSettingsView from './PTSettingsView';

export default async function PTSettingsPage() {
  const supabase = await createClient();
  const exercises = await fetchAllPTExercises(supabase);
  return <PTSettingsView exercises={exercises} />;
}
