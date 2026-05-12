import Link from "next/link";

const FOOTER_LINKS = [
  { href: "/finance", label: "Finance" },
  { href: "/operators", label: "Operators" },
  { href: "/blog", label: "Blog" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

export default function SiteFooter() {
  return (
    <footer className="border-t border-black px-6 py-8 md:px-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <span className="font-display text-sm font-medium uppercase tracking-[0.1em] text-black">
          Cerebro
        </span>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {FOOTER_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-[0.62rem] font-medium uppercase tracking-[0.14em] text-black/35 transition-colors hover:text-black"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <span className="text-xs font-light text-black/30">&copy; 2026 Cerebro</span>
      </div>
    </footer>
  );
}
