import FadeIn from '@/app/components/FadeIn';

export default function CoachProblem() {
  return (
    <section className="py-20 md:py-[140px] px-6 md:px-12">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col md:flex-row gap-12 md:gap-20">

          <div className="flex-1">
            <FadeIn>
              <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black mb-8">
                What&apos;s actually going on
              </p>
              <p className="text-sm font-light text-black/70 leading-relaxed">
                Your mind hasn&apos;t slowed down. You still want to hike, lift, play, move like you
                always did. Your body just stopped keeping up. Something hurts. A back, a knee, a
                shoulder. So you&apos;ve quietly stopped doing things and called it age.
              </p>
            </FadeIn>
          </div>

          <div className="flex-1">
            <FadeIn>
              <p className="text-sm font-light text-black/70 leading-relaxed mb-5">
                It isn&apos;t age. It&apos;s mostly muscular imbalance and movement you were never
                taught. Close that gap and the body catches up to the mind again. Pain goes.
                Movement comes back. The sport comes back. You keep it for decades.
              </p>
              <p className="text-sm font-light text-black leading-relaxed">
                That&apos;s the whole job. That&apos;s what I do.
              </p>
            </FadeIn>
          </div>

        </div>
      </div>
    </section>
  );
}
