'use client';

import { useRef } from 'react';
import FadeIn from '@/app/components/FadeIn';

interface Testimonial {
  id: number;
  name: string;
  title: string;
  quote: string;
}

// Faithful excerpts from real LinkedIn recommendations.
const TESTIMONIALS: Testimonial[] = [
  {
    id: 1,
    name: 'Karin Upton Baker',
    title: 'Managing Director, Hermès Australia',
    quote:
      'He prepped me for a hike in the Atlas Mountains, then made strength part of my everyday life. He trained me through injuries, good days and bad. Tough but fair — just what you need. After 2.5 years, I miss his presence.',
  },
  {
    id: 2,
    name: 'Stephen Layfield',
    title: 'Specialist in luxury branding and design',
    quote:
      'Pedro understands the individual — not just your goals, but your body, your history and how you move. In my 50s, that attention has been invaluable. Back, knees, shoulder — he assessed and addressed each one.',
  },
  {
    id: 3,
    name: 'Benjamin Chong',
    title: 'Founder & Investor, Right Click Capital',
    quote:
      'A rare combination of thoughtful operator and highly effective coach. He asks insightful questions, thinks deeply, and delivers feedback in a calm, considered and encouraging way.',
  },
  {
    id: 4,
    name: 'Phil Sharp',
    title: 'Senior Financial Advisor, Morgan Stanley Private Wealth',
    quote:
      "Knee pain had forced me to give up surfing. Pedro eliminated the pain I'd dealt with for years and got me back in the water. He genuinely cares about your outcomes.",
  },
  {
    id: 5,
    name: 'Jenny Macdonald',
    title: 'Non-Executive Director',
    quote:
      'What sets Pedro apart is his understanding of where health, wellness and technology intersect — a depth that goes well beyond physical training.',
  },
];

export default function CoachTestimonials() {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'prev' | 'next') => {
    const el = scrollRef.current;
    if (!el) return;
    const cardWidth = 384; // card + gap
    el.scrollBy({ left: direction === 'next' ? cardWidth : -cardWidth, behavior: 'smooth' });
  };

  return (
    <section className="py-20 md:py-[140px]">
      <div className="max-w-5xl mx-auto px-6 md:px-12">
        <FadeIn>
          <div className="flex items-end justify-between mb-10">
            <div>
              <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black mb-3">
                What they say
              </p>
              <p className="text-sm font-light text-black/50 max-w-sm leading-relaxed">
                The people I work with lead demanding lives. Here&apos;s what changed for them.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => scroll('prev')}
                aria-label="Previous testimonial"
                className="w-9 h-9 border border-black/20 flex items-center justify-center hover:border-black transition-colors duration-200"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25">
                  <path d="M9 2L4 7l5 5" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => scroll('next')}
                aria-label="Next testimonial"
                className="w-9 h-9 border border-black/20 flex items-center justify-center hover:border-black transition-colors duration-200"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25">
                  <path d="M5 2l5 5-5 5" />
                </svg>
              </button>
            </div>
          </div>
        </FadeIn>
      </div>

      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto px-6 md:px-12 pb-2"
        style={{ scrollSnapType: 'x mandatory', scrollbarWidth: 'none' }}
      >
        {TESTIMONIALS.map((t) => (
          <article
            key={t.id}
            className="flex-shrink-0 w-[300px] md:w-[368px] border border-black/10 bg-white p-7 md:p-8 flex flex-col"
            style={{ scrollSnapAlign: 'start' }}
          >
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="text-black/12 mb-5"
              aria-hidden="true"
            >
              <path d="M9.5 4C6 5.5 4 8.5 4 12.5V20h7v-7H7.8c0-2.6 1-4.4 3.2-5.4L9.5 4zm9 0C15 5.5 13 8.5 13 12.5V20h7v-7h-3.2c0-2.6 1-4.4 3.2-5.4L18.5 4z" />
            </svg>

            <p
              className="font-display font-light text-black/85 leading-[1.45] mb-7 flex-1"
              style={{ fontSize: 'clamp(1.05rem, 1.4vw, 1.2rem)' }}
            >
              {t.quote}
            </p>

            <div className="pt-5 border-t border-black/8">
              <p className="text-[0.7rem] font-medium tracking-[0.08em] uppercase text-black">
                {t.name}
              </p>
              <p className="text-[0.7rem] font-light text-black/40 mt-0.5">{t.title}</p>
              <span className="mt-3 inline-flex items-center gap-1.5 text-[0.55rem] font-medium tracking-[0.14em] uppercase text-black/30">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 110-4.13 2.06 2.06 0 010 4.13zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.22.79 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
                </svg>
                LinkedIn recommendation
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
