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
              &ldquo;The Australian fitness market shrank 7% last year. Your
              software got more expensive. Your members got more selective. The
              studios that come out ahead aren&apos;t the ones with the best
              programming. They&apos;re the ones who fixed what their front desk
              never had time to fix.&rdquo;
            </p>
            <p className="text-[clamp(0.95rem,1.8vw,1.1rem)] font-light leading-[1.8] text-black/60 max-w-[540px] mt-8">
              Trial members ghost. Leads sit unanswered until Monday. Payments
              fail and nobody chases. Members drift away for two weeks before
              they cancel. None of it is complicated. None of it gets fixed
              because you&apos;re on the floor.
            </p>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
