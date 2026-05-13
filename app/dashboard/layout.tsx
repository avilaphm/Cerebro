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
    <div className="liquid-dashboard flex min-h-screen min-w-0 p-3">
      <DashboardSidebar userEmail={user.email ?? ''} />
      <main className="min-h-[calc(100vh-1.5rem)] min-w-0 flex-1 overflow-y-auto pt-16 md:ml-[15.25rem] md:pt-0">
        {children}
      </main>
    </div>
  );
}
