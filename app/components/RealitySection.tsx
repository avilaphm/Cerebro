import FadeIn from "./FadeIn";

export default function RealitySection() {
  return (
    <section className="py-[140px] px-6 md:px-12">
      <div className="max-w-5xl mx-auto">
        <FadeIn>
          <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black mb-16">
            The reality
          </p>
          <div className="max-w-[700px]">
            <p className="font-display text-[clamp(1.4rem,3.2vw,2rem)] font-light leading-[1.65] text-black italic">
              &ldquo;The bottleneck is rarely a lack of expertise. It is that
              expertise spends half the week collecting data, comparing
              versions, rewriting reports, and finding information the business
              already has.&rdquo;
            </p>
            <p className="text-[clamp(0.95rem,1.8vw,1.1rem)] font-light leading-[1.8] text-black/60 max-w-[540px] mt-8">
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
