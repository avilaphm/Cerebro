import { createClient } from '@/utils/supabase/server';
import type { PTClient } from '@/utils/pt/types';
import PTClientsView from './PTClientsView';

export default async function PTClientsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('pt_clients')
    .select('*')
    .order('created_at', { ascending: false });

  const clients = (data ?? []) as PTClient[];

  return <PTClientsView initialClients={clients} />;
}
