import { createClient } from '@/utils/supabase/server';
import type { PTClient } from '@/utils/pt/types';
import PTMessagesView from './PTMessagesView';

export default async function PTMessagesPage() {
  const supabase = await createClient();

  const [clientRes, msgRes] = await Promise.all([
    supabase.from('pt_clients').select('*').order('name'),
    supabase
      .from('pt_messages')
      .select('client_id, content, sender, read_at, created_at')
      .order('created_at', { ascending: false }),
  ]);

  const clients = (clientRes.data ?? []) as PTClient[];
  const messages = msgRes.data ?? [];

  const unreadByClient: Record<string, number> = {};
  const lastMessageByClient: Record<string, { content: string; created_at: string; sender: string }> = {};

  for (const m of messages) {
    if (!lastMessageByClient[m.client_id]) {
      lastMessageByClient[m.client_id] = { content: m.content, created_at: m.created_at, sender: m.sender };
    }
    if (m.sender === 'client' && !m.read_at) {
      unreadByClient[m.client_id] = (unreadByClient[m.client_id] ?? 0) + 1;
    }
  }

  const sortedClients = [...clients].sort((a, b) => {
    const aUnread = unreadByClient[a.id] ?? 0;
    const bUnread = unreadByClient[b.id] ?? 0;
    if (aUnread !== bUnread) return bUnread - aUnread;
    const aLast = lastMessageByClient[a.id]?.created_at ?? '';
    const bLast = lastMessageByClient[b.id]?.created_at ?? '';
    return bLast.localeCompare(aLast);
  });

  return (
    <PTMessagesView
      clients={sortedClients}
      unreadByClient={unreadByClient}
      lastMessageByClient={lastMessageByClient}
    />
  );
}
