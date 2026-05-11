import { createClient } from '@/utils/supabase/server';
import type { PTExercise } from '@/utils/pt/types';
import PTSettingsView from './PTSettingsView';

export default async function PTSettingsPage() {
  const supabase = await createClient();
  const { data } = await supabase.from('pt_exercises').select('*').order('name');
  const exercises = (data ?? []) as PTExercise[];
  return <PTSettingsView exercises={exercises} />;
}
