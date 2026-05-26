import FadeIn from '@/app/components/FadeIn';

export default function CoachBetweenSessions() {
  return (
    <section className="py-20 md:py-[140px] px-6 md:px-12">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col md:flex-row gap-12 md:gap-20 items-start">

          <div className="flex-1">
            <FadeIn>
              <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black mb-8">
                The system
              </p>
              <h2
                className="font-display font-light tracking-[-0.02em] leading-[1.1] text-black mb-6"
                style={{ fontSize: 'clamp(1.6rem, 3.2vw, 2.8rem)' }}
              >
                Here&apos;s the part most trainers skip.
              </h2>
              <p className="text-sm font-light text-black/70 leading-relaxed mb-4">
                I built a simple system that keeps me in your corner when you&apos;re not with me.
                Your program, what to do, a quick check-in. I see how you&apos;re going and adjust.
                You&apos;re never guessing on your own.
              </p>
              <p className="text-sm font-light text-black/70 leading-relaxed">
                You don&apos;t need to be techy. You don&apos;t need to track anything. That&apos;s
                my job.
              </p>
            </FadeIn>
          </div>

          <div className="w-full md:w-[200px] flex-shrink-0">
            <FadeIn>
              <div
                className="bg-black/5 border border-black/10 flex items-center justify-center"
                style={{ aspectRatio: '9/16', maxWidth: '200px' }}
              >
                <span className="text-[0.6rem] font-medium tracking-[0.12em] uppercase text-black/30">
                  [ App screenshot ]
                </span>
              </div>
            </FadeIn>
          </div>

        </div>
      </div>
    </section>
  );
}
