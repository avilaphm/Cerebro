import FadeIn from "./FadeIn";

export default function WhyCerebroSection() {
  return (
    <section className="py-[140px] px-6 md:px-12">
      <div className="max-w-5xl mx-auto">
        <FadeIn>
          <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black mb-10">
            Why Cerebro
          </p>

          <div className="text-[1.05rem] font-light text-black/60 leading-[1.9] max-w-[560px] space-y-6">
            <p>
              I trained clients at PE Department, Redfern. I know what Sunday
              evening looks like when you&apos;re behind on programs, DMs, and
              unpaid invoices.
            </p>
            <p>
              I started building these systems because I needed them for my own
              practice. Then I started building them for other operators.
            </p>
            <p className="text-black">
              Cerebro is for the fitness business owner who built something real
              and wants to stop running it on gut feel and Sunday night catch-up.
            </p>
          </div>

          <p className="font-display text-base italic text-black mt-10">
            Pedro
          </p>
        </FadeIn>
      </div>
    </section>
  );
}
