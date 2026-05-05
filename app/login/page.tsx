'use client';

import { useState } from 'react';
import { createClient } from '@/utils/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setSent(true);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <p className="font-display text-sm font-medium tracking-[0.18em] uppercase text-black mb-12">
          Cerebro
        </p>

        {sent ? (
          <div>
            <h1 className="font-display text-2xl font-light tracking-[-0.02em] text-black mb-3">
              Check your inbox.
            </h1>
            <p className="text-sm font-light text-black/50 leading-relaxed">
              We sent a magic link to <span className="text-black">{email}</span>. Click it to sign in.
            </p>
          </div>
        ) : (
          <form onSubmit={handleLogin}>
            <h1 className="font-display text-2xl font-light tracking-[-0.02em] text-black mb-8">
              Sign in to Cerebro.
            </h1>

            <div className="mb-4">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Your email"
                required
                className="w-full border border-black/20 rounded-xl px-4 py-3 text-sm text-black placeholder:text-black/35 focus:outline-none focus:ring-1 focus:ring-black bg-white"
              />
            </div>

            {error && (
              <p className="text-xs text-red-600 mb-4">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !email}
              className="w-full bg-black text-white rounded-xl px-4 py-3 text-sm font-medium tracking-[0.06em] disabled:opacity-40 hover:opacity-80 transition-opacity"
            >
              {loading ? 'Sending…' : 'Send magic link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
