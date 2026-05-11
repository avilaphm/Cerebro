import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import ClientPortal from './ClientPortal';

export default async function ClientPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/client-login');

  return <ClientPortal userEmail={user.email ?? ''} />;
}
