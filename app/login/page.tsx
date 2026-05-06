'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

type Mode = 'login' | 'reset' | 'reset-sent';

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push('/dashboard');
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/update-password`,
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setMode('reset-sent');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <p className="font-display text-sm font-medium tracking-[0.18em] uppercase text-black mb-12">
          Cerebro
        </p>

        {mode === 'reset-sent' ? (
          <div>
            <h1 className="font-display text-2xl font-light tracking-[-0.02em] text-black mb-3">
              Check your inbox.
            </h1>
            <p className="text-sm font-light text-black/50 leading-relaxed">
              We sent a password reset link to <span className="text-black">{email}</span>.
            </p>
            <button
              onClick={() => { setMode('login'); setError(''); }}
              className="mt-6 text-xs text-black/40 hover:text-black transition-colors"
            >
              Back to sign in
            </button>
          </div>
        ) : mode === 'reset' ? (
          <form onSubmit={handleReset}>
            <h1 className="font-display text-2xl font-light tracking-[-0.02em] text-black mb-3">
              Reset password.
            </h1>
            <p className="text-sm font-light text-black/50 mb-8">
              Enter your email and we'll send a reset link.
            </p>

            <div className="mb-6">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                required
                className="w-full border border-black/20 rounded-xl px-4 py-3 text-sm text-black placeholder:text-black/35 focus:outline-none focus:ring-1 focus:ring-black bg-white"
              />
            </div>

            {error && <p className="text-xs text-red-600 mb-4">{error}</p>}

            <button
              type="submit"
              disabled={loading || !email}
              className="w-full bg-black text-white rounded-xl px-4 py-3 text-sm font-medium tracking-[0.06em] disabled:opacity-40 hover:opacity-80 transition-opacity"
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>

            <button
              type="button"
              onClick={() => { setMode('login'); setError(''); }}
              className="mt-4 w-full text-xs text-black/40 hover:text-black transition-colors"
            >
              Back to sign in
            </button>
          </form>
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
                placeholder="Email"
                required
                className="w-full border border-black/20 rounded-xl px-4 py-3 text-sm text-black placeholder:text-black/35 focus:outline-none focus:ring-1 focus:ring-black bg-white"
              />
            </div>

            <div className="mb-2">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                required
                className="w-full border border-black/20 rounded-xl px-4 py-3 text-sm text-black placeholder:text-black/35 focus:outline-none focus:ring-1 focus:ring-black bg-white"
              />
            </div>

            <div className="mb-6 text-right">
              <button
                type="button"
                onClick={() => { setMode('reset'); setError(''); }}
                className="text-xs text-black/40 hover:text-black transition-colors"
              >
                Forgot password?
              </button>
            </div>

            {error && <p className="text-xs text-red-600 mb-4">{error}</p>}

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full bg-black text-white rounded-xl px-4 py-3 text-sm font-medium tracking-[0.06em] disabled:opacity-40 hover:opacity-80 transition-opacity"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
