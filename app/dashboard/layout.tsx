import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { isPedroAdminEmail } from '@/utils/pt/access';
import DashboardSidebar from './Sidebar';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.role !== 'admin' && !isPedroAdminEmail(user.email)) {
    redirect('/client');
  }

  return (
    <div className="flex min-h-screen bg-white">
      <DashboardSidebar userEmail={user.email ?? ''} />
      <main className="flex-1 min-h-screen pt-14 md:pt-0 md:ml-64">
        {children}
      </main>
    </div>
  );
}
