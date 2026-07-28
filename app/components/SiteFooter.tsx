import Link from "next/link";
import CerebroMark from "@/components/brand/CerebroMark";

const FOOTER_LINKS = [
  { href: "/blog", label: "Blog" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

export default function SiteFooter() {
  return (
    <footer className="border-t border-white/15 bg-[#0a0a0a] px-6 py-9 text-white md:px-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <Link
          href="/"
          aria-label="Cerebro home"
          className="flex items-center gap-2.5 text-white"
        >
          <CerebroMark className="h-7 w-[2.1rem]" />
          <span className="font-display text-sm font-medium uppercase tracking-[0.1em]">
            Cerebro
          </span>
        </Link>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {FOOTER_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-[0.62rem] font-medium uppercase tracking-[0.14em] text-white/35 transition-colors hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <span className="text-xs font-light text-white/30">&copy; 2026 Cerebro</span>
      </div>
    </footer>
  );
}
