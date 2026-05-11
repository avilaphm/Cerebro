'use client';

import { useState } from 'react';
import { createClient } from '@/utils/supabase/client';

export default function ClientLoginPage() {
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');
  const [sent, setSent] = useState(false);

  const sendLink = async () => {
    if (!email.trim()) return;
    setStatus('Sending login link...');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/client`,
      },
    });

    if (error) {
      setStatus(error.message);
      return;
    }

    setSent(true);
    setStatus('Check your email for the login link.');
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f7f3] px-5">
      <section className="w-full max-w-md border border-black/10 bg-white p-8">
        <p className="text-[0.65rem] uppercase tracking-[0.2em] text-black/35">Cerebro PT</p>
        <h1 className="mt-3 font-display text-3xl font-light tracking-[-0.02em]">Client login</h1>
        <p className="mt-3 text-sm leading-relaxed text-black/50">
          Enter the email Pedro used for your programme.
        </p>
        <div className="mt-6 space-y-3">
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full border border-black/10 bg-[#fbfbf8] px-4 py-3 text-sm outline-none focus:border-black/40"
            placeholder="you@example.com"
            type="email"
          />
          <button
            type="button"
            onClick={sendLink}
            disabled={sent}
            className="w-full border border-black bg-black px-4 py-3 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sent ? 'Link sent' : 'Send login link'}
          </button>
        </div>
        {status && <p className="mt-4 text-sm text-black/50">{status}</p>}
      </section>
    </main>
  );
}
