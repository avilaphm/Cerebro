import { notFound } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { safeProgramme } from '@/utils/pt/programme';
import type {
  PTKnowledgeRetrievalLog,
  PTProgramGenerationRun,
  PTProgramGenerationStep,
  PTProgramReviewOutput,
} from '@/utils/pt/types';
import PTProgrammeReviewView from './PTProgrammeReviewView';

export default async function PTProgrammeReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [runRes, stepsRes, retrievalRes, reviewsRes] = await Promise.all([
    supabase
      .from('pt_program_generation_runs')
      .select('*, pt_clients(name, email, goals), pt_program_assignments(id, name, goal)')
      .eq('id', id)
      .single(),
    supabase
      .from('pt_program_generation_steps')
      .select('*')
      .eq('run_id', id)
      .order('step_order', { ascending: true }),
    supabase
      .from('pt_knowledge_retrieval_logs')
      .select('*')
      .eq('run_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('pt_program_review_outputs')
      .select('*')
      .eq('run_id', id)
      .order('created_at', { ascending: false }),
  ]);

  if (runRes.error || !runRes.data) notFound();

  const run = {
    ...(runRes.data as PTProgramGenerationRun),
    programme_draft: safeProgramme((runRes.data as PTProgramGenerationRun).programme_draft),
  };

  return (
    <PTProgrammeReviewView
      run={run}
      steps={(stepsRes.data ?? []) as PTProgramGenerationStep[]}
      retrievalLogs={(retrievalRes.data ?? []) as PTKnowledgeRetrievalLog[]}
      reviewOutputs={(reviewsRes.data ?? []) as PTProgramReviewOutput[]}
    />
  );
}
