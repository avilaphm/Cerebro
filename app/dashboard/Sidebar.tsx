'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
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
  const [open, setOpen] = useState(false);

  // Close drawer on route change (mobile)
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll when drawer is open on mobile
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
    <>
      {/* Mobile top bar — visible only below md */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-black flex items-center justify-between px-4 z-40">
        <Link
          href="/"
          className="font-display text-sm font-medium tracking-[0.18em] uppercase text-white no-underline"
        >
          Cerebro
        </Link>
        <button
          type="button"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-10 items-center justify-center text-white"
        >
          {open ? (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 6h16M3 11h16M3 16h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Backdrop — mobile only, when drawer open */}
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="md:hidden fixed inset-0 bg-black/40 z-40"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 h-full w-64 bg-black flex flex-col z-50 transform transition-transform duration-200 ease-out md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-6 py-6 border-b border-white/10">
          <Link
            href="/"
            className="font-display text-sm font-medium tracking-[0.18em] uppercase text-white no-underline"
          >
            Cerebro
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
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
    </>
  );
}
