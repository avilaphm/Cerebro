'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { label: 'Overview',    href: '/dashboard/pt/overview' },
  { label: 'Messages',    href: '/dashboard/pt/messages' },
  { label: 'Groups',      href: '/dashboard/pt/groups' },
  { label: 'Clients',     href: '/dashboard/pt/clients' },
  { label: 'Programmes',  href: '/dashboard/pt/programmes' },
  { label: 'Emails',      href: '/dashboard/pt/emails' },
  { label: 'Settings',    href: '/dashboard/pt/settings' },
];

export default function PTNav() {
  const pathname = usePathname();
  return (
    <aside className="w-48 shrink-0 border-r border-black/8 bg-[#fafaf8] flex flex-col min-h-full">
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
              className={`block px-3 py-2 rounded text-sm transition-colors ${
                active
                  ? 'bg-black text-white'
                  : 'text-black/50 hover:text-black hover:bg-black/5'
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
