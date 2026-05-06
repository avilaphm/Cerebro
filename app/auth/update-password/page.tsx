'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push('/dashboard');
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <p className="font-display text-sm font-medium tracking-[0.18em] uppercase text-black mb-12">
          Cerebro
        </p>

        <form onSubmit={handleSubmit}>
          <h1 className="font-display text-2xl font-light tracking-[-0.02em] text-black mb-8">
            Set your password.
          </h1>

          <div className="mb-4">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password"
              required
              minLength={8}
              className="w-full border border-black/20 rounded-xl px-4 py-3 text-sm text-black placeholder:text-black/35 focus:outline-none focus:ring-1 focus:ring-black bg-white"
            />
          </div>

          <div className="mb-6">
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm password"
              required
              minLength={8}
              className="w-full border border-black/20 rounded-xl px-4 py-3 text-sm text-black placeholder:text-black/35 focus:outline-none focus:ring-1 focus:ring-black bg-white"
            />
          </div>

          {error && <p className="text-xs text-red-600 mb-4">{error}</p>}

          <button
            type="submit"
            disabled={loading || !password || !confirm}
            className="w-full bg-black text-white rounded-xl px-4 py-3 text-sm font-medium tracking-[0.06em] disabled:opacity-40 hover:opacity-80 transition-opacity"
          >
            {loading ? 'Saving…' : 'Set password'}
          </button>
        </form>
      </div>
    </div>
  );
}
