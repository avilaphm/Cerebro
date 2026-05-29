import FadeIn from '@/app/components/FadeIn';

export default function CoachBio() {
  return (
    <section className="py-20 md:py-[140px] px-6 md:px-12">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col md:flex-row gap-12 md:gap-20">

          <div className="w-full md:w-[280px] flex-shrink-0">
            <FadeIn>
              <div className="flex flex-col gap-3">
                <img
                  src="/coach/pedro-portrait.jpg"
                  alt="Portrait of Pedro Avila"
                  width={1800}
                  height={1200}
                  className="w-full aspect-[3/4] object-cover object-center"
                />
                <img
                  src="/coach/pedro-training.jpg"
                  alt="Pedro Avila coaching a client through a loaded squat"
                  width={1400}
                  height={1400}
                  className="w-full aspect-[3/4] object-cover object-center"
                />
              </div>
            </FadeIn>
          </div>

          <div className="flex-1 flex flex-col justify-center">
            <FadeIn>
              <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black mb-8">
                Who I am
              </p>
              <h2
                className="font-display font-light tracking-[-0.02em] leading-[1.1] text-black mb-6"
                style={{ fontSize: 'clamp(1.6rem, 3.2vw, 2.8rem)' }}
              >
                I&apos;m Pedro. Nearly ten years coaching people out of pain and back into their lives.
              </h2>
              <p className="text-sm font-light text-black/70 leading-relaxed mb-4">
                My thing is simple. I look at how you actually move. We fix the imbalances first.
                We build real strength through full range, the way the body is meant to work. You
                learn your own body as we go, so you&apos;re not dependent on me forever.
              </p>
              <p className="text-sm font-light text-black/70 leading-relaxed mb-8">
                The goal was never to get you shredded. It&apos;s to keep you strong, mobile and
                independent for decades.
              </p>
              <p className="text-[0.7rem] font-medium tracking-[0.12em] uppercase text-black/40">
                P.E. Dept, Potts Point · @meet.avila
              </p>
            </FadeIn>
          </div>

        </div>
      </div>
    </section>
  );
}
