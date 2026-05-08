"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();
  const isBlog = pathname?.startsWith("/blog");

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 sm:px-6 md:px-12 py-4 md:py-5 bg-white/90 backdrop-blur-md transition-[border-color] duration-300 ${
        scrolled ? "border-b border-black" : "border-b border-transparent"
      }`}
    >
      <Link
        href="/"
        className="font-display text-sm font-medium tracking-[0.12em] uppercase text-black no-underline"
      >
        Cerebro
      </Link>
      <div className="flex items-center gap-3 sm:gap-6">
        <Link
          href="/blog"
          className={`text-[0.7rem] font-medium tracking-[0.12em] uppercase no-underline transition-colors duration-200 ${
            isBlog ? "text-black" : "text-black/40 hover:text-black"
          }`}
        >
          Blog
        </Link>
        <a
          href="/#start"
          className="text-[0.65rem] sm:text-[0.7rem] font-medium tracking-[0.1em] sm:tracking-[0.12em] uppercase text-black border border-black px-3 sm:px-5 py-2 sm:py-2.5 no-underline transition-[background,color] duration-200 hover:bg-black hover:text-white whitespace-nowrap"
        >
          <span className="sm:hidden">Start</span>
          <span className="hidden sm:inline">Start the conversation</span>
        </a>
      </div>
    </nav>
  );
}
