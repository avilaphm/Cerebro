import FadeIn from "./FadeIn";

const OUTCOMES = [
  "Lead replies happen the moment someone reaches out. Day or night.",
  "Clients get onboarded without you lifting a finger.",
  "Follow-ups happen at the right time, in the right tone, every time.",
  "Reports compile themselves while you sleep.",
];

export default function WhatChangesSection() {
  return (
    <section className="py-[140px] px-6 md:px-12">
      <div className="max-w-5xl mx-auto">
        <FadeIn>
          <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black mb-16">
            What changes
          </p>
          <ul>
            {OUTCOMES.map((outcome, i) => (
              <li
                key={outcome}
                className="flex items-start gap-8 py-8 border-t border-black group cursor-default"
              >
                <span className="text-[0.65rem] font-medium text-black/30 tracking-[0.1em] w-6 shrink-0 mt-[0.4rem] tabular-nums">
                  0{i + 1}
                </span>
                <span className="text-[clamp(1.05rem,2.2vw,1.3rem)] font-light leading-snug text-black/50 group-hover:text-black transition-colors duration-300">
                  {outcome}
                </span>
              </li>
            ))}
            <li className="border-t border-black" aria-hidden="true" />
          </ul>
          <p className="text-sm font-light text-black/60 leading-relaxed mt-12 max-w-[480px]">
            Your week gets lighter. Your service gets sharper. Nothing dropped.
          </p>
        </FadeIn>
      </div>
    </section>
  );
}
