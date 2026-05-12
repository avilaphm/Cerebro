import Link from "next/link";

const DOORS = [
  {
    href: "/",
    label: "Fitness",
    blurb: "Gyms, studios, and PTs.",
  },
  {
    href: "/finance",
    label: "Finance",
    blurb: "Diligence, roll-ups, and reporting clarity.",
  },
  {
    href: "/operators",
    label: "Operators",
    blurb: "Founder-led service businesses with handoff friction.",
  },
];

export default function MarketingDoors({ activeHref }: { activeHref: string }) {
  return (
    <div className="grid gap-px overflow-hidden border border-black bg-black md:grid-cols-3">
      {DOORS.map((door) => {
        const active = door.href === activeHref;

        return (
          <Link
            key={door.href}
            href={door.href}
            className={`group bg-white px-5 py-5 transition-colors duration-200 md:px-6 ${
              active ? "bg-black text-white" : "text-black hover:bg-[#f3f0ea]"
            }`}
          >
            <div className="flex items-center justify-between gap-4">
              <span className="font-display text-[1.2rem] font-light tracking-[-0.02em]">
                {door.label}
              </span>
              <span
                className={`text-[0.65rem] font-medium uppercase tracking-[0.16em] ${
                  active ? "text-white/70" : "text-black/35"
                }`}
              >
                {active ? "Current" : "Enter"}
              </span>
            </div>
            <p
              className={`mt-3 max-w-[18rem] text-sm font-light leading-relaxed ${
                active
                  ? "text-white/72"
                  : "text-black/55 group-hover:text-black/70"
              }`}
            >
              {door.blurb}
            </p>
          </Link>
        );
      })}
    </div>
  );
}
