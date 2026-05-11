import { notFound } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import type { PTClient, PTProgramTemplate, PTProgramAssignment } from '@/utils/pt/types';
import { safeProgramme } from '@/utils/pt/programme';
import PTClientDetail from './PTClientDetail';

interface PTNote {
  id: string;
  content: string;
  is_active: boolean;
  created_at: string;
  source_message_id: string | null;
}

interface PTEvent {
  id: string;
  event_type: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

export default async function PTClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [clientRes, templatesRes, assignmentsRes, eventsRes, notesRes] = await Promise.all([
    supabase.from('pt_clients').select('*').eq('id', id).single(),
    supabase.from('pt_program_templates').select('*').eq('status', 'ready').order('name'),
    supabase
      .from('pt_program_assignments')
      .select('*')
      .eq('client_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('pt_events')
      .select('*')
      .eq('client_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('pt_client_notes')
      .select('*')
      .eq('client_id', id)
      .eq('is_active', true)
      .order('created_at', { ascending: false }),
  ]);

  if (clientRes.error || !clientRes.data) notFound();

  const client = clientRes.data as PTClient;
  const templates = ((templatesRes.data ?? []) as PTProgramTemplate[]).map((t) => ({
    ...t,
    programme: safeProgramme(t.programme),
  }));
  const assignments = ((assignmentsRes.data ?? []) as PTProgramAssignment[]).map((a) => ({
    ...a,
    programme: safeProgramme(a.programme),
  }));
  const events = (eventsRes.data ?? []) as PTEvent[];
  const notes = (notesRes.data ?? []) as PTNote[];

  return (
    <PTClientDetail
      client={client}
      templates={templates}
      assignments={assignments}
      events={events}
      notes={notes}
    />
  );
}
