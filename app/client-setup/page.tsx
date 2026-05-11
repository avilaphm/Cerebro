import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import ClientSetupForm from './ClientSetupForm';

export default async function ClientSetupPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/client-login');

  const { data: ptClient } = await supabase
    .from('pt_clients')
    .select('name, email')
    .eq('user_id', user.id)
    .maybeSingle();

  const name = ptClient?.name ?? (user.user_metadata?.full_name as string | undefined) ?? '';
  const email = ptClient?.email ?? user.email ?? '';

  return <ClientSetupForm name={name} email={email} />;
}
