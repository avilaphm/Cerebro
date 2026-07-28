import FadeIn from "./FadeIn";

const SEGMENTS = [
  "Construction, engineering, and advisory teams producing recurring analysis and client reports.",
  "Expert service firms with 10 to 50 people and expensive judgement buried under repeatable work.",
  "Founder-led businesses where every increase in revenue currently requires another hire.",
  "Teams with good software, but critical work still living in Excel, inboxes, SharePoint, and memory.",
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
            The common thread is not the industry. It is valuable people losing
            time to work a well-built system should already handle.
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
            More output. Same headcount.
          </p>
        </FadeIn>
      </div>
    </section>
  );
}
