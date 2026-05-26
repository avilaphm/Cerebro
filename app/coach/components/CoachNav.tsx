'use client';

import { useEffect, useState } from 'react';

export default function CoachNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 h-14 md:h-auto md:py-5 transition-[background-color,backdrop-filter,border-color] duration-300 ${
        scrolled
          ? 'bg-white/90 backdrop-blur-md border-b border-black'
          : 'bg-transparent border-b border-transparent'
      }`}
    >
      <span className="font-display text-sm font-medium tracking-[0.12em] uppercase text-black">
        Pedro Avila
      </span>

      <a
        href="#start"
        className="text-[0.7rem] font-medium tracking-[0.12em] uppercase text-white bg-black px-5 py-2.5 no-underline transition-[background,color] duration-200 hover:bg-black/80"
      >
        Book assessment — $10
      </a>
    </nav>
  );
}
