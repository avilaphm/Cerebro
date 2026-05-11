import { createClient } from '@/utils/supabase/server';
import type { PTClient } from '@/utils/pt/types';
import PTClientsView from './PTClientsView';

export default async function PTClientsPage() {
  const supabase = await createClient();

  const [clientRes, notesRes] = await Promise.all([
    supabase.from('pt_clients').select('*').order('created_at', { ascending: false }),
    supabase.from('pt_client_notes').select('client_id').eq('is_active', true),
  ]);

  const clients = (clientRes.data ?? []) as PTClient[];
  const notesByClient: Record<string, number> = {};
  for (const n of notesRes.data ?? []) {
    notesByClient[n.client_id] = (notesByClient[n.client_id] ?? 0) + 1;
  }

  return <PTClientsView initialClients={clients} notesByClient={notesByClient} />;
}
