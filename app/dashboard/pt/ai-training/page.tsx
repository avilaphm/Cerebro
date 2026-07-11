import { createClient } from '@/utils/supabase/server';
import AITraining from './AITraining';

export const dynamic = 'force-dynamic';

export default async function AITrainingPage() {
  const supabase = await createClient();

  const [answersRes, statusRes] = await Promise.all([
    supabase.from('pt_ai_training_answers').select('question_key, answer_text'),
    supabase.from('pt_ai_training_status').select('completed, completed_at').eq('id', 1).maybeSingle(),
  ]);

  const initialAnswers: Record<string, string> = {};
  for (const row of answersRes.data ?? []) {
    if (row.answer_text) initialAnswers[row.question_key] = row.answer_text;
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <AITraining
        initialAnswers={initialAnswers}
        initialCompleted={Boolean(statusRes.data?.completed)}
      />
    </div>
  );
}
