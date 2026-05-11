'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

export default function ClientLoginPage() {
  const supabase = createClient();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setStatus('');
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error) {
      setStatus(error.message);
      setLoading(false);
      return;
    }

    router.push('/client');
  };

  const sendMagicLink = async () => {
    if (!email.trim()) return;
    setSendingLink(true);
    setStatus('Sending login link...');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/client`,
        shouldCreateUser: false,
      },
    });

    if (error) {
      setStatus(error.message);
      setSendingLink(false);
      return;
    }

    setStatus('Check your email for the login link.');
    setSendingLink(false);
  };

  const sendPasswordReset = async () => {
    if (!email.trim()) return;
    setSendingReset(true);
    setStatus('Sending password reset link...');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/client`,
    });

    if (error) {
      setStatus(error.message);
      setSendingReset(false);
      return;
    }

    setStatus('Check your email for the password reset link.');
    setSendingReset(false);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f7f3] px-5">
      <section className="w-full max-w-md border border-black/10 bg-white p-8">
        <p className="text-[0.65rem] uppercase tracking-[0.2em] text-black/35">Cerebro PT</p>
        <h1 className="mt-3 font-display text-3xl font-light tracking-[-0.02em]">Client login</h1>
        <p className="mt-3 text-sm leading-relaxed text-black/50">
          Enter the email Pedro used for your programme.
        </p>
        <form onSubmit={login} className="mt-6 space-y-3">
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full border border-black/10 bg-[#fbfbf8] px-4 py-3 text-sm outline-none focus:border-black/40"
            placeholder="you@example.com"
            type="email"
          />
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full border border-black/10 bg-[#fbfbf8] px-4 py-3 text-sm outline-none focus:border-black/40"
            placeholder="Password"
            type="password"
          />
          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full border border-black bg-black px-4 py-3 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? 'Logging in...' : 'Log in'}
          </button>
        </form>
        <button
          type="button"
          onClick={sendMagicLink}
          disabled={sendingLink || sendingReset || !email}
          className="mt-3 w-full border border-black/10 px-4 py-3 text-sm text-black/55 transition-colors hover:border-black/30 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sendingLink ? 'Sending...' : 'Email me a one-click login link'}
        </button>
        <button
          type="button"
          onClick={sendPasswordReset}
          disabled={sendingReset || sendingLink || !email}
          className="mt-3 w-full px-4 py-2 text-sm text-black/40 transition-colors hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sendingReset ? 'Sending...' : 'Forgot password?'}
        </button>
        {status && <p className="mt-4 text-sm text-black/50">{status}</p>}
      </section>
    </main>
  );
}
