'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

const NAV = [
  { label: 'Overview', href: '/dashboard', icon: '◈' },
  { label: 'Leads', href: '/dashboard/leads', icon: '◎' },
  { label: 'Blog', href: '/dashboard/blog', icon: '◻' },
  { label: 'Social', href: '/dashboard/social', icon: '◇' },
  { label: 'Settings', href: '/dashboard/social/settings', icon: '◉' },
];

export default function DashboardSidebar({ userEmail }: { userEmail: string }) {
  const pathname = usePathname();
  const router = useRouter();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
    <aside className="fixed left-0 top-0 h-full w-64 bg-black flex flex-col z-40">
      <div className="px-6 py-6 border-b border-white/10">
        <Link
          href="/"
          className="font-display text-sm font-medium tracking-[0.18em] uppercase text-white no-underline"
        >
          Cerebro
        </Link>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map((item) => {
          const active =
            item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-white/15 text-white'
                  : 'text-white/50 hover:text-white hover:bg-white/8'
              }`}
            >
              <span className="text-base leading-none">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-6 py-5 border-t border-white/10">
        <p className="text-xs text-white/40 truncate mb-3">{userEmail}</p>
        <button
          onClick={handleSignOut}
          className="text-xs text-white/40 hover:text-white transition-colors"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
