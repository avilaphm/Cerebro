'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { label: 'Overview',    href: '/dashboard/pt/overview' },
  { label: 'PT Sessions', href: '/dashboard/pt/pt-sessions' },
  { label: 'M & L Assessment', href: '/dashboard/pt/ml-assessment' },
  { label: 'Movement Screening', href: '/dashboard/pt/movement-screening' },
  { label: 'Messages',    href: '/dashboard/pt/messages' },
  { label: 'Groups',      href: '/dashboard/pt/groups' },
  { label: 'Clients',     href: '/dashboard/pt/clients' },
  { label: 'Bookings',    href: '/dashboard/pt/bookings' },
  { label: 'Programmes',  href: '/dashboard/pt/programmes' },
  { label: 'Exercises',   href: '/dashboard/pt/exercises' },
  { label: 'Knowledge',   href: '/dashboard/pt/knowledge' },
  { label: 'Emails',      href: '/dashboard/pt/emails' },
  { label: 'Settings',    href: '/dashboard/pt/settings' },
];

export default function PTNav() {
  const pathname = usePathname();
  return (
    <aside className="pt-glass-nav flex w-full shrink-0 flex-col overflow-hidden border border-black/8 rounded-[20px] md:min-h-full md:w-48">
      <div className="hidden border-b border-black/8 px-5 py-5 md:block">
        <p className="text-[0.6rem] uppercase tracking-[0.22em] text-black/35 font-medium">PT</p>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-2 py-2 md:flex-1 md:flex-col md:space-y-0.5 md:overflow-visible md:py-3">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block whitespace-nowrap px-3 py-2 text-sm transition-colors ${
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
