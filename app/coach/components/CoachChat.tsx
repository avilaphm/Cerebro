'use client';

import { useState } from 'react';

export default function CoachChat() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitted(true);
  };

  return (
    <section id="start" className="bg-black text-white py-20 md:py-[140px] px-6 md:px-12 scroll-mt-0">
      <div className="max-w-5xl mx-auto">
        <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-white/40 mb-8">
          Start the conversation
        </p>

        <h2
          className="font-display font-light tracking-[-0.02em] leading-[1.1] text-white mb-5"
          style={{ fontSize: 'clamp(1.8rem, 4vw, 3.5rem)' }}
        >
          It&apos;s not too late. It&apos;s not just your age. And you don&apos;t have to figure it
          out alone.
        </h2>

        <p className="text-sm font-light text-white/50 leading-relaxed mb-10">
          Let&apos;s get you moving again.
        </p>

        <div className="bg-white/5 border border-white/10 rounded-lg p-6 mt-8 max-w-xl">
          {submitted ? (
            <p className="text-sm font-light text-white/70 leading-relaxed">
              Got it. We&apos;ll be in touch soon.
            </p>
          ) : (
            <>
              <p className="text-sm font-light text-white/50 mb-5">
                Chat coming soon — leave your email and we&apos;ll reach out.
              </p>
              <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Your email address"
                  required
                  className="bg-white/10 border border-white/20 text-white placeholder:text-white/30 px-4 py-3 outline-none focus:border-white/50 flex-1 text-sm font-light"
                />
                <button
                  type="submit"
                  className="bg-white text-black px-6 py-3 text-sm font-medium hover:bg-white/90 transition-colors duration-200 whitespace-nowrap"
                >
                  Start the conversation →
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
