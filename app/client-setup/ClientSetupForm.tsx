'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

export default function ClientSetupForm({ name, email }: { name: string; email: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const supabase = createClient();

  const firstName = name ? name.split(' ')[0] : '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError('');
    const { data: updatedUser, error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setLoading(false);
    } else {
      if (updatedUser.user?.email) {
        await supabase
          .from('pt_clients')
          .update({ password_created_at: new Date().toISOString() })
          .eq('email', updatedUser.user.email.toLowerCase());
      }
      router.push('/client');
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f7f3] px-5">
      <section className="w-full max-w-md border border-black/10 bg-white p-8">
        <p className="text-[0.65rem] uppercase tracking-[0.2em] text-black/35">Cerebro PT</p>
        <h1 className="mt-3 font-display text-3xl font-light tracking-[-0.02em]">
          {firstName ? `Welcome, ${firstName}.` : 'Welcome.'}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-black/50">
          Create a password to access your programme.
        </p>

        <div className="mt-6 border border-black/10 bg-[#fbfbf8] px-4 py-3">
          {name && <p className="text-sm font-medium text-black">{name}</p>}
          <p className="text-sm text-black/50">{email}</p>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Create password"
            required
            minLength={8}
            className="w-full border border-black/10 bg-[#fbfbf8] px-4 py-3 text-sm outline-none focus:border-black/40"
          />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm password"
            required
            minLength={8}
            className="w-full border border-black/10 bg-[#fbfbf8] px-4 py-3 text-sm outline-none focus:border-black/40"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password || !confirm}
            className="w-full border border-black bg-black px-4 py-3 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? 'Setting up...' : 'Access my programme'}
          </button>
        </form>
      </section>
    </main>
  );
}
