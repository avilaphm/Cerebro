import { createClient } from '@/utils/supabase/server';
import type { PTGroup, PTClient } from '@/utils/pt/types';
import PTGroupsView from './PTGroupsView';

interface PTGroupMember {
  group_id: string;
  client_id: string;
}

export default async function PTGroupsPage() {
  const supabase = await createClient();

  const [groupsRes, membersRes, clientsRes] = await Promise.all([
    supabase.from('pt_groups').select('*').order('name'),
    supabase.from('pt_group_members').select('group_id, client_id'),
    supabase.from('pt_clients').select('id, name, email, status').order('name'),
  ]);

  const groups = (groupsRes.data ?? []) as PTGroup[];
  const members = (membersRes.data ?? []) as PTGroupMember[];
  const clients = (clientsRes.data ?? []) as Pick<PTClient, 'id' | 'name' | 'email' | 'status'>[];

  return <PTGroupsView groups={groups} members={members} clients={clients} />;
}
