'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { label: 'Overview',    href: '/dashboard/pt/overview' },
  { label: 'Messages',    href: '/dashboard/pt/messages' },
  { label: 'Groups',      href: '/dashboard/pt/groups' },
  { label: 'Clients',     href: '/dashboard/pt/clients' },
  { label: 'Bookings',    href: '/dashboard/pt/bookings' },
  { label: 'Programmes',  href: '/dashboard/pt/programmes' },
  { label: 'Emails',      href: '/dashboard/pt/emails' },
  { label: 'Settings',    href: '/dashboard/pt/settings' },
];

export default function PTNav() {
  const pathname = usePathname();
  return (
    <aside className="pt-glass-nav w-48 shrink-0 border border-black/8 flex flex-col min-h-full rounded-[20px]">
      <div className="px-5 py-5 border-b border-black/8">
        <p className="text-[0.6rem] uppercase tracking-[0.22em] text-black/35 font-medium">PT</p>
      </div>
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block px-3 py-2 text-sm transition-colors ${
                active
                  ? 'border border-black/15 bg-black text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]'
                  : 'border border-transparent text-black/50 hover:border-black/10 hover:bg-black/5 hover:text-black'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
