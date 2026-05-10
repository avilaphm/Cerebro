import FadeIn from "./FadeIn";

const SEGMENTS = [
  "Solo PTs and coaches. 10 to 40 active clients. Admin eating your evenings.",
  "Boutique studio and gym owners. 80 to 350 members. First-year churn to fix.",
  "Multi-site operators. Two to five locations. Fragmented systems, decisions in the dark.",
];

export default function WhoItsForSection() {
  return (
    <section className="py-[140px] px-6 md:px-12">
      <div className="max-w-5xl mx-auto">
        <FadeIn>
          <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black mb-16">
            Who it&apos;s for
          </p>

          <p className="font-display text-[clamp(1.4rem,3vw,1.9rem)] font-light leading-[1.5] text-black max-w-[720px] mb-16">
            If you run a gym, studio, or PT practice in Australia or New
            Zealand, this is built for you.
          </p>

          <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-12">
            {SEGMENTS.map((segment, i) => (
              <li
                key={segment}
                className="flex items-start gap-6 py-6 border-t border-black"
              >
                <span className="text-[0.65rem] font-medium text-black/30 tracking-[0.1em] w-6 shrink-0 mt-[0.3rem] tabular-nums">
                  0{i + 1}
                </span>
                <span className="text-[clamp(0.95rem,1.6vw,1.05rem)] font-light leading-snug text-black/70">
                  {segment}
                </span>
              </li>
            ))}
            <li className="border-t border-black md:col-span-2" aria-hidden="true" />
          </ul>

          <p className="text-sm font-light text-black/50 mt-10 italic">
            Same operational ceiling. One fix.
          </p>
        </FadeIn>
      </div>
    </section>
  );
}
