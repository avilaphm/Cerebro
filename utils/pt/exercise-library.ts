import type { PTExercise } from './types';

type QueryResult = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;

type ExerciseQuery = {
  range: (from: number, to: number) => QueryResult;
};

type ExerciseOrderQuery = {
  order: (column: string, options?: { ascending?: boolean }) => ExerciseQuery;
};

type ExerciseSelectQuery = {
  select: (columns: string) => ExerciseOrderQuery;
};

type SupabaseExerciseClient = {
  from: (table: 'pt_exercises') => ExerciseSelectQuery;
};

export async function fetchAllPTExercises(supabase: SupabaseExerciseClient): Promise<PTExercise[]> {
  const pageSize = 1000;
  const exercises: PTExercise[] = [];

  for (let from = 0; from < 20_000; from += pageSize) {
    const { data, error } = await supabase
      .from('pt_exercises')
      .select('*')
      .order('name', { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as PTExercise[];
    exercises.push(...rows);
    if (rows.length < pageSize) break;
  }

  return exercises;
}
