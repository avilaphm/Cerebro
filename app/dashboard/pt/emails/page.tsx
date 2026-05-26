import { createClient } from '@/utils/supabase/server';
import type { PTClient } from '@/utils/pt/types';
import PTEmailsView, { type PTEmailNotification } from './PTEmailsView';

interface RawNotification {
  id: string;
  created_at: string;
  client_id: string | null;
  notification_type: string;
  recipient_email: string;
  subject: string;
  pt_clients: { name: string } | { name: string }[] | null;
}

function normalizeNotification(row: RawNotification): PTEmailNotification {
  const client = Array.isArray(row.pt_clients) ? (row.pt_clients[0] ?? null) : row.pt_clients;
  return {
    id: row.id,
    created_at: row.created_at,
    client_id: row.client_id,
    notification_type: row.notification_type,
    recipient_email: row.recipient_email,
    subject: row.subject,
    pt_clients: client,
  };
}

export default async function PTEmailsPage() {
  const supabase = await createClient();

  const [clientRes, notificationRes] = await Promise.all([
    supabase
      .from('pt_clients')
      .select('*')
      .neq('status', 'archived')
      .order('name'),
    supabase
      .from('pt_notification_log')
      .select('id, created_at, client_id, notification_type, recipient_email, subject, pt_clients(name)')
      .order('created_at', { ascending: false })
      .limit(12),
  ]);

  return (
    <PTEmailsView
      clients={(clientRes.data ?? []) as PTClient[]}
      recentNotifications={((notificationRes.data ?? []) as RawNotification[]).map(normalizeNotification)}
    />
  );
}
