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
              I ran service businesses for ten years before I started building
              these systems. Not because I studied automation. Because I was
              drowning in admin and knew there had to be a better way.
            </p>
            <p>
              I built the systems for my own business first. Then I started
              building them for others.
            </p>
            <p className="text-black">
              Cerebro exists because every business owner deserves to spend
              their day on the work they actually care about. Not the work
              that just needs to get done.
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
