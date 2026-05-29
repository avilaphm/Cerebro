'use client';

import { useEffect, useRef, useState } from 'react';

export default function CoachHero() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [beat, setBeat] = useState<1 | 2 | 3>(1);

  useEffect(() => {
    const handleScroll = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const totalScrollable = el.offsetHeight - window.innerHeight;
      const scrolled = -rect.top;
      const progress = Math.max(0, Math.min(1, scrolled / totalScrollable));

      if (progress < 0.33) {
        setBeat(1);
      } else if (progress < 0.67) {
        setBeat(2);
      } else {
        setBeat(3);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const earlyVisible = beat === 1 || beat === 2;
  const lateVisible = beat === 3;

  return (
    <div ref={containerRef} className="relative" style={{ height: '300vh' }}>
      <div className="sticky top-0 h-screen flex items-center overflow-hidden">
        <div className="w-full max-w-5xl mx-auto px-6 md:px-12">

          {/* Beats 1 & 2 */}
          <div
            className={`absolute inset-x-6 md:inset-x-12 transition-[opacity,transform] duration-700 ease-out ${
              earlyVisible
                ? 'opacity-100 translate-y-0 pointer-events-auto'
                : 'opacity-0 translate-y-4 pointer-events-none'
            }`}
          >
            <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black mb-6">
              Pedro Avila Coaching
            </p>

            <p
              className={`text-sm font-light text-black/60 leading-relaxed max-w-md transition-[opacity,transform] duration-700 ease-out ${
                beat >= 1
                  ? 'opacity-100 translate-y-0'
                  : 'opacity-0 translate-y-3'
              }`}
            >
              Your mind hasn&apos;t slowed down. You still want to hike, lift, play, move like you
              always did.
            </p>

            <div
              className={`mt-8 transition-[opacity,transform] duration-700 ease-out ${
                beat >= 2
                  ? 'opacity-100 translate-y-0'
                  : 'opacity-0 translate-y-3'
              }`}
            >
              <h1 className="font-display font-light tracking-[-0.02em] leading-[1.05] text-black"
                style={{ fontSize: 'clamp(2.8rem, 7vw, 6.5rem)' }}>
                Your body just stopped keeping up.
              </h1>
            </div>
          </div>

          {/* Beat 3 */}
          <div
            className={`absolute inset-x-6 md:inset-x-12 transition-[opacity,transform] duration-700 ease-out ${
              lateVisible
                ? 'opacity-100 translate-y-0 pointer-events-auto'
                : 'opacity-0 translate-y-4 pointer-events-none'
            }`}
          >
            <div className="flex flex-col md:flex-row gap-7 md:gap-20 items-start">
              <div className="flex-1">
                <h1
                  className="font-display font-light tracking-[-0.02em] leading-[1.05] text-black mb-5 md:mb-6"
                  style={{ fontSize: 'clamp(2rem, 4.5vw, 4.2rem)' }}
                >
                  Your body stopped keeping up with your mind. I help it catch back up.
                </h1>
                <p className="text-sm font-light text-black/60 leading-relaxed max-w-md mb-6 md:mb-8">
                  Out of pain, moving freely, back to the things you stopped doing.
                </p>
                <a
                  href="#start"
                  className="inline-flex items-center text-[0.75rem] font-medium tracking-[0.12em] uppercase text-white bg-black px-7 py-4 no-underline transition-[background] duration-200 hover:bg-black/80"
                >
                  Book my movement assessment — $10
                </a>
              </div>

              {/* Hero photo: desktop only. On mobile the scroll-hero is one fixed
                  viewport, so a tall portrait would push the CTA off-screen; the
                  first photo on mobile is the bio portrait immediately below. */}
              <div className="hidden md:block md:w-[340px] flex-shrink-0">
                <img
                  src="/coach/pedro-hero.jpg"
                  alt="Pedro Avila training with kettlebells on the Auckland waterfront"
                  width={1001}
                  height={1500}
                  className="w-full aspect-[3/4] object-cover object-top"
                />
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
