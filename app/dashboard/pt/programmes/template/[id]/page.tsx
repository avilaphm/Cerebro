import { notFound } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { safeProgramme } from '@/utils/pt/programme';
import type { PTProgramTemplate, PTClient } from '@/utils/pt/types';
import PTProgrammeTemplateView from './PTProgrammeTemplateView';

export default async function PTProgrammeTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [templateRes, clientsRes] = await Promise.all([
    supabase.from('pt_program_templates').select('*').eq('id', id).single(),
    supabase.from('pt_clients').select('id, name, email, status').in('status', ['active', 'invited']).order('name'),
  ]);

  if (templateRes.error || !templateRes.data) notFound();

  const template: PTProgramTemplate = {
    ...(templateRes.data as PTProgramTemplate),
    programme: safeProgramme((templateRes.data as PTProgramTemplate).programme),
  };

  return (
    <PTProgrammeTemplateView
      template={template}
      clients={(clientsRes.data ?? []) as PTClient[]}
    />
  );
}
