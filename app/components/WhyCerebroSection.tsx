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
              I have worked inside construction projects, fitness practices,
              product businesses, and small teams where the useful work and the
              admin around it slowly became the same thing.
            </p>
            <p>
              I do not arrive with a platform and ask your team to adapt. I
              spend two afternoons a week inside the business, understand how
              the work really moves, then build around it.
            </p>
            <p className="text-black">
              The first version will not be perfect. That is why I stay close
              enough to see it fail, fix it, and make it fit the business before
              calling it finished.
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
