import FadeIn from '@/app/components/FadeIn';

const STEPS = [
  {
    number: '01',
    copy: 'Book your assessment. $10 to hold the spot, credited straight to your training. It just means you\'re serious.',
  },
  {
    number: '02',
    copy: 'We meet at P.E. Dept, Potts Point. A few quick questions first, then I watch how you move. Nothing heavy. No judgement.',
  },
  {
    number: '03',
    copy: 'You leave knowing what\'s going on. Either we start training, or you walk away with a clear picture of your body and what to do about it. Either way you understand more than when you walked in.',
  },
];

export default function CoachProcess() {
  return (
    <section className="py-20 md:py-[140px] px-6 md:px-12">
      <div className="max-w-5xl mx-auto">
        <FadeIn>
          <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black mb-16">
            How it works
          </p>
        </FadeIn>

        <div className="flex flex-col divide-y divide-black/10">
          {STEPS.map((step) => (
            <FadeIn key={step.number}>
              <div className="flex flex-col md:flex-row gap-4 md:gap-16 py-10 md:py-14">
                <div className="flex-shrink-0">
                  <span
                    className="font-display font-light text-black/10 leading-none select-none"
                    style={{ fontSize: '6rem' }}
                  >
                    {step.number}
                  </span>
                </div>
                <div className="flex items-center">
                  <p
                    className="font-display font-light tracking-[-0.015em] leading-[1.3] text-black"
                    style={{ fontSize: 'clamp(1.1rem, 2.2vw, 1.5rem)' }}
                  >
                    {step.copy}
                  </p>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>

        <FadeIn>
          <div className="mt-14">
            <a
              href="#start"
              className="inline-flex items-center text-[0.75rem] font-medium tracking-[0.12em] uppercase text-white bg-black px-7 py-4 no-underline transition-[background] duration-200 hover:bg-black/80"
            >
              Book my movement assessment — $10
            </a>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
