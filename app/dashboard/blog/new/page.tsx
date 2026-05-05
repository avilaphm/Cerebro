'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

export default function NewBlogPage() {
  const [topic, setTopic] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || loading) return;

    setLoading(true);
    setError('');

    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const res = await fetch(`${supabaseUrl}/functions/v1/generate-blog`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ topic: topic.trim(), notes: notes.trim() || undefined }),
      });

      const data = await res.json();

      if (!res.ok || !data.slug) {
        setError(data.error ?? 'Something went wrong. Please try again.');
        setLoading(false);
        return;
      }

      router.push(`/blog/${data.slug}`);
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl">
      <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black/40 mb-2">
        Blog
      </p>
      <h1 className="font-display text-3xl font-light tracking-[-0.02em] text-black mb-2">
        New post
      </h1>
      <p className="text-sm font-light text-black/50 mb-10">
        Give Cerebro a topic and a few notes. It will write and publish the full post, then generate LinkedIn and X drafts for you to review.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-xs font-medium tracking-wide uppercase text-black/40 mb-2">
            Topic
          </label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Why small businesses lose leads after hours"
            required
            disabled={loading}
            className="w-full border border-black/20 rounded-xl px-4 py-3 text-sm text-black placeholder:text-black/30 focus:outline-none focus:ring-1 focus:ring-black bg-white disabled:opacity-50"
          />
        </div>

        <div>
          <label className="block text-xs font-medium tracking-wide uppercase text-black/40 mb-2">
            Notes <span className="normal-case font-normal text-black/30">(optional)</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Key points to cover, angle to take, examples to include, target audience..."
            rows={5}
            disabled={loading}
            className="w-full resize-none border border-black/20 rounded-xl px-4 py-3 text-sm text-black placeholder:text-black/30 focus:outline-none focus:ring-1 focus:ring-black bg-white disabled:opacity-50"
          />
        </div>

        {error && (
          <p className="text-xs text-red-600">{error}</p>
        )}

        <button
          type="submit"
          disabled={!topic.trim() || loading}
          className="bg-black text-white text-sm px-6 py-3 rounded-xl hover:opacity-80 transition-opacity disabled:opacity-30 flex items-center gap-2"
        >
          {loading ? (
            <>
              <span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Writing… this takes about 30 seconds
            </>
          ) : (
            'Generate and publish'
          )}
        </button>
      </form>
    </div>
  );
}
