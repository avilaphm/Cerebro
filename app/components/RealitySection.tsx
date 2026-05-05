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
              &ldquo;Every small business runs on the same hidden tax. The work
              that grows the business keeps getting pushed to tomorrow. Because
              today is full of the work that just needs to get done.&rdquo;
            </p>
            <p className="text-[clamp(0.95rem,1.8vw,1.1rem)] font-light leading-[1.8] text-black/60 max-w-[540px] mt-8">
              Invoices. Follow-ups. Onboarding. Reports. Scheduling. None of it
              is hard. All of it takes time. And it never stops. So nothing
              important moves.
            </p>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
