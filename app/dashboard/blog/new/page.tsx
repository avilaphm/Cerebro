'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

type Mode = 'ai' | 'manual';

export default function NewBlogPage() {
  const [mode, setMode] = useState<Mode>('ai');

  // AI mode state
  const [topic, setTopic] = useState('');
  const [notes, setNotes] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  // Manual mode state
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState('');

  const router = useRouter();
  const supabase = createClient();

  const handleAiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || aiLoading) return;

    setAiLoading(true);
    setAiError('');

    try {
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
        setAiError(data.error ?? 'Something went wrong. Please try again.');
        setAiLoading(false);
        return;
      }

      router.push(`/blog/${data.slug}`);
    } catch {
      setAiError('Something went wrong. Please try again.');
      setAiLoading(false);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim() || manualLoading) return;

    setManualLoading(true);
    setManualError('');

    try {
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 60)
        .replace(/-$/, '') + '-' + Date.now().toString(36);

      const { error } = await supabase.from('blog_posts').insert({
        title: title.trim(),
        slug,
        content_md: content.trim(),
        meta_description: metaDescription.trim() || null,
        status: 'research_draft',
        author: 'Pedro Avila',
      });

      if (error) {
        setManualError(error.message ?? 'Something went wrong. Please try again.');
        setManualLoading(false);
        return;
      }

      router.push('/dashboard/blog');
    } catch {
      setManualError('Something went wrong. Please try again.');
      setManualLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl">
      <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black/40 mb-2">Blog</p>
      <h1 className="font-display text-3xl font-light tracking-[-0.02em] text-black mb-6">New post</h1>

      {/* Mode toggle */}
      <div className="flex items-center gap-1 p-1 border border-black/10 rounded-xl w-fit mb-8">
        <button
          onClick={() => setMode('ai')}
          className={`text-sm px-4 py-2 rounded-lg transition-colors ${
            mode === 'ai' ? 'bg-black text-white' : 'text-black/50 hover:text-black'
          }`}
        >
          Ask AI
        </button>
        <button
          onClick={() => setMode('manual')}
          className={`text-sm px-4 py-2 rounded-lg transition-colors ${
            mode === 'manual' ? 'bg-black text-white' : 'text-black/50 hover:text-black'
          }`}
        >
          Write manually
        </button>
      </div>

      {/* AI mode */}
      {mode === 'ai' && (
        <>
          <p className="text-sm font-light text-black/50 mb-8">
            Give Cerebro a topic and a few notes. It will write the full post, then generate LinkedIn and X drafts for you to review.
          </p>
          <form onSubmit={handleAiSubmit} className="space-y-6">
            <div>
              <label className="block text-xs font-medium tracking-wide uppercase text-black/40 mb-2">Topic</label>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Why senior teams still spend weeks rebuilding reports"
                required
                disabled={aiLoading}
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
                disabled={aiLoading}
                className="w-full resize-none border border-black/20 rounded-xl px-4 py-3 text-sm text-black placeholder:text-black/30 focus:outline-none focus:ring-1 focus:ring-black bg-white disabled:opacity-50"
              />
            </div>
            {aiError && <p className="text-xs text-red-600">{aiError}</p>}
            <button
              type="submit"
              disabled={!topic.trim() || aiLoading}
              className="bg-black text-white text-sm px-6 py-3 rounded-xl hover:opacity-80 transition-opacity disabled:opacity-30 flex items-center gap-2"
            >
              {aiLoading ? (
                <>
                  <span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Writing… this takes about 30 seconds
                </>
              ) : (
                'Generate and publish'
              )}
            </button>
          </form>
        </>
      )}

      {/* Manual mode */}
      {mode === 'manual' && (
        <>
          <p className="text-sm font-light text-black/50 mb-8">
            Write it yourself. Saves as a draft you can edit, refine with AI, and publish when ready.
          </p>
          <form onSubmit={handleManualSubmit} className="space-y-6">
            <div>
              <label className="block text-xs font-medium tracking-wide uppercase text-black/40 mb-2">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. The one habit that saves my clients 3 hours a week"
                required
                disabled={manualLoading}
                className="w-full border border-black/20 rounded-xl px-4 py-3 text-sm text-black placeholder:text-black/30 focus:outline-none focus:ring-1 focus:ring-black bg-white disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium tracking-wide uppercase text-black/40 mb-2">Content</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write in markdown. # for headings, **bold**, *italic*, - for bullet points."
                rows={16}
                required
                disabled={manualLoading}
                className="w-full resize-y font-mono border border-black/20 rounded-xl px-4 py-3 text-sm text-black placeholder:text-black/30 focus:outline-none focus:ring-1 focus:ring-black bg-white disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium tracking-wide uppercase text-black/40 mb-2">
                Meta description <span className="normal-case font-normal text-black/30">(optional, under 160 chars)</span>
              </label>
              <input
                type="text"
                value={metaDescription}
                onChange={(e) => setMetaDescription(e.target.value)}
                placeholder="One or two sentences for SEO"
                maxLength={160}
                disabled={manualLoading}
                className="w-full border border-black/20 rounded-xl px-4 py-3 text-sm text-black placeholder:text-black/30 focus:outline-none focus:ring-1 focus:ring-black bg-white disabled:opacity-50"
              />
            </div>
            {manualError && <p className="text-xs text-red-600">{manualError}</p>}
            <button
              type="submit"
              disabled={!title.trim() || !content.trim() || manualLoading}
              className="bg-black text-white text-sm px-6 py-3 rounded-xl hover:opacity-80 transition-opacity disabled:opacity-30 flex items-center gap-2"
            >
              {manualLoading ? (
                <>
                  <span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Saving…
                </>
              ) : (
                'Save as draft'
              )}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
