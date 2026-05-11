import { createClient } from '@/utils/supabase/server';
import type { PTClient, PTGroup } from '@/utils/pt/types';
import PTClientsView from './PTClientsView';

export default async function PTClientsPage() {
  const supabase = await createClient();

  const [clientRes, notesRes, groupsRes, membersRes] = await Promise.all([
    supabase.from('pt_clients').select('*').order('created_at', { ascending: false }),
    supabase.from('pt_client_notes').select('client_id').eq('is_active', true),
    supabase.from('pt_groups').select('*').order('name'),
    supabase.from('pt_group_members').select('group_id, client_id'),
  ]);

  const clients = (clientRes.data ?? []) as PTClient[];
  const groups = (groupsRes.data ?? []) as PTGroup[];

  const notesByClient: Record<string, number> = {};
  for (const n of notesRes.data ?? []) {
    notesByClient[n.client_id] = (notesByClient[n.client_id] ?? 0) + 1;
  }

  const groupsByClient: Record<string, PTGroup[]> = {};
  for (const m of membersRes.data ?? []) {
    const g = groups.find((x) => x.id === m.group_id);
    if (!g) continue;
    groupsByClient[m.client_id] = [...(groupsByClient[m.client_id] ?? []), g];
  }

  return <PTClientsView initialClients={clients} notesByClient={notesByClient} groupsByClient={groupsByClient} />;
}
