import FadeIn from "./FadeIn";
import CerebroMark from "@/components/brand/CerebroMark";

export default function RealitySection() {
  return (
    <section className="relative overflow-hidden bg-[#0a0a0a] px-6 py-[140px] text-white md:px-12">
      <CerebroMark className="pointer-events-none absolute -right-16 top-14 h-auto w-[19rem] text-white/[0.06] md:right-12 md:top-16 md:w-[24rem]" />
      <div className="relative mx-auto max-w-6xl">
        <FadeIn>
          <p className="mb-16 text-[0.65rem] font-medium uppercase tracking-[0.2em] text-white/45">
            The reality
          </p>
          <div className="max-w-[780px]">
            <p className="font-display text-[clamp(1.5rem,3.2vw,2.25rem)] font-light italic leading-[1.55] text-white">
              &ldquo;The bottleneck is rarely a lack of expertise. It is that
              expertise spends half the week collecting data, comparing
              versions, rewriting reports, and finding information the business
              already has.&rdquo;
            </p>
            <p className="mt-10 max-w-[560px] text-[clamp(0.95rem,1.8vw,1.1rem)] font-light leading-[1.8] text-white/55">
              Revenue grows, then headcount has to follow. Senior people end up
              doing work a graduate could do. Reports arrive after the decision
              window has closed. The business is busy, but output is still tied
              to how many hours the team can personally carry.
            </p>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
