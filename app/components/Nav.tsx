"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Add new pages here. They'll appear in both desktop nav and mobile menu.
const NAV_LINKS: { href: string; label: string }[] = [
  { href: "/blog", label: "Blog" },
];

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  // Close menu on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll while menu is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname?.startsWith(href) ?? false;

  return (
    <>
      <nav
        className={`fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 h-14 md:h-auto md:py-5 bg-white/90 backdrop-blur-md transition-[border-color] duration-300 ${
          scrolled || open ? "border-b border-black" : "border-b border-transparent"
        }`}
      >
        <Link
          href="/"
          onClick={() => setOpen(false)}
          className="font-display text-sm font-medium tracking-[0.12em] uppercase text-black no-underline"
        >
          Cerebro
        </Link>

        {/* Desktop nav — md and up */}
        <div className="hidden md:flex items-center gap-6">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-[0.7rem] font-medium tracking-[0.12em] uppercase no-underline transition-colors duration-200 ${
                isActive(link.href) ? "text-black" : "text-black/40 hover:text-black"
              }`}
            >
              {link.label}
            </Link>
          ))}
          <a
            href="/#start"
            className="text-[0.7rem] font-medium tracking-[0.12em] uppercase text-black border border-black px-5 py-2.5 no-underline transition-[background,color] duration-200 hover:bg-black hover:text-white"
          >
            Start the conversation
          </a>
        </div>

        {/* Mobile hamburger — below md */}
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="md:hidden flex h-10 w-10 -mr-2 items-center justify-center text-black"
        >
          {open ? (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.25">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.25">
              <path d="M3 8h16M3 15h16" />
            </svg>
          )}
        </button>
      </nav>

      {/* Mobile menu panel — slides down beneath the nav */}
      <div
        className={`md:hidden fixed left-0 right-0 top-14 bottom-0 bg-white z-40 transition-[opacity,transform] duration-200 ease-out ${
          open
            ? "opacity-100 translate-y-0 pointer-events-auto"
            : "opacity-0 -translate-y-2 pointer-events-none"
        }`}
        aria-hidden={!open}
      >
        <div className="flex flex-col h-full px-6 pt-10 pb-10">
          <nav className="flex flex-col gap-7">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`font-display text-3xl font-light tracking-[-0.01em] no-underline ${
                  isActive(link.href) ? "text-black" : "text-black/45"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <a
            href="/#start"
            onClick={() => setOpen(false)}
            className="mt-auto inline-flex justify-center items-center text-[0.75rem] font-medium tracking-[0.14em] uppercase text-white bg-black px-6 py-4 no-underline"
          >
            Start the conversation
          </a>
        </div>
      </div>
    </>
  );
}
