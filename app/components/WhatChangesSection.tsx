import FadeIn from "./FadeIn";

const OUTCOMES = [
  "A lead messages at 9pm. They have a booking link before you finish dinner.",
  "A member misses two classes. Your coach gets a flag before it turns into a cancellation.",
  "A payment fails. It retries, messages the member, and recovers automatically.",
  "Sunday evening. A 90-second summary of your week lands in your inbox instead.",
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
            Your floor time stays yours. The numbers take care of themselves.
          </p>
        </FadeIn>
      </div>
    </section>
  );
}
