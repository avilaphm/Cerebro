'use client';

import { useRef } from 'react';
import FadeIn from '@/app/components/FadeIn';

interface Testimonial {
  id: number;
  name: string;
  title: string;
  quote?: string;
}

const TESTIMONIALS: Testimonial[] = [
  {
    id: 1,
    name: 'Stephen Layfield',
    title: 'Specialist in luxury branding and design',
    quote:
      'Pedro takes the time to genuinely understand the individual, not just your goals, but your body, your history and how you move. I was dealing with ongoing problems in my back, knees and shoulder. I\'m now training without pain.',
  },
  {
    id: 2,
    name: 'Phil Sharp',
    title: 'Senior Financial Advisor, Morgan Stanley Private Wealth',
    quote:
      'Knee pain had forced me to give up surfing. Pedro eliminated the pain I\'d dealt with for years and got me back in the water. He genuinely cares about your outcomes.',
  },
  {
    id: 3,
    name: 'Karin Upton Baker',
    title: 'Managing Director, Hermès Australia',
    quote:
      'Tough but fair. Just what you need. He trained me through injuries, good days and bad days. After more than 2.5 years I miss his presence.',
  },
  {
    id: 4,
    name: 'Jenny Macdonald',
    title: 'Non Executive Director',
    quote:
      'What sets Pedro apart is his understanding of where health, wellness and technology intersect. A depth that goes well beyond physical training.',
  },
  {
    id: 5,
    name: 'Benjamin Chong',
    title: 'Founder and Investor, Right Click Capital',
    quote: 'A rare combination of thoughtful operator and highly effective coach.',
  },
  { id: 6, name: '', title: '' },
  { id: 7, name: '', title: '' },
  { id: 8, name: '', title: '' },
];

export default function CoachTestimonials() {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'prev' | 'next') => {
    const el = scrollRef.current;
    if (!el) return;
    const cardWidth = 316;
    el.scrollBy({ left: direction === 'next' ? cardWidth : -cardWidth, behavior: 'smooth' });
  };

  return (
    <section className="py-20 md:py-[140px]">
      <div className="max-w-5xl mx-auto px-6 md:px-12">
        <FadeIn>
          <div className="flex items-end justify-between mb-10">
            <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black">
              What they say
            </p>
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
        className="flex gap-3 overflow-x-auto px-6 md:px-12 pb-2"
        style={{ scrollSnapType: 'x mandatory', scrollbarWidth: 'none' }}
      >
        {TESTIMONIALS.map((t) => (
          <div
            key={t.id}
            className="flex-shrink-0 flex flex-col gap-3"
            style={{ scrollSnapAlign: 'start', minWidth: '300px' }}
          >
            <div className="aspect-[4/5] bg-black/5 border border-black/10 flex items-center justify-center">
              <span className="text-[0.6rem] font-medium tracking-[0.12em] uppercase text-black/30">
                LinkedIn Screenshot {t.id}
              </span>
            </div>
            {t.quote && (
              <div className="px-1">
                <p className="text-xs font-light text-black/60 leading-relaxed italic mb-2">
                  &ldquo;{t.quote}&rdquo;
                </p>
                <p className="text-[0.65rem] font-medium tracking-[0.08em] uppercase text-black">
                  {t.name}
                </p>
                <p className="text-[0.65rem] font-light text-black/40">{t.title}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
