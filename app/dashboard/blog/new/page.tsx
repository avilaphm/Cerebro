'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

export default function NewBlogPage() {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !content.trim() || loading) return;

    setLoading(true);
    setErrorMessage('');

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
        setErrorMessage(error.message ?? 'The draft could not be saved.');
        return;
      }

      router.push('/dashboard/blog');
    } catch {
      setErrorMessage('The draft could not be saved.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black/40 mb-2">Blog</p>
      <h1 className="font-display text-3xl font-light tracking-[-0.02em] text-black mb-3">Write a post</h1>
      <p className="text-sm leading-relaxed text-black/50 mb-8">
        This is the manual editor. For a sourced Cerebro article, use the construction research workspace on the{' '}
        <Link href="/dashboard/blog#blog-research" className="text-black underline underline-offset-4">
          blog dashboard
        </Link>
        .
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="manual-title" className="block text-xs font-medium tracking-wide uppercase text-black/40 mb-2">
            Title
          </label>
          <input
            id="manual-title"
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="The report was already late before anyone opened Word"
            required
            disabled={loading}
            className="w-full border border-black/20 rounded-xl px-4 py-3 text-sm text-black placeholder:text-black/35 focus:outline-none focus:ring-1 focus:ring-black bg-white disabled:opacity-50"
          />
        </div>

        <div>
          <label htmlFor="manual-content" className="block text-xs font-medium tracking-wide uppercase text-black/40 mb-2">
            Content
          </label>
          <textarea
            id="manual-content"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Write in Markdown."
            rows={18}
            required
            disabled={loading}
            className="w-full resize-y font-mono border border-black/20 rounded-xl px-4 py-3 text-sm text-black placeholder:text-black/35 focus:outline-none focus:ring-1 focus:ring-black bg-white disabled:opacity-50"
          />
        </div>

        <div>
          <label htmlFor="manual-meta" className="block text-xs font-medium tracking-wide uppercase text-black/40 mb-2">
            Meta description <span className="normal-case font-normal text-black/35">(optional, under 160 characters)</span>
          </label>
          <input
            id="manual-meta"
            type="text"
            value={metaDescription}
            onChange={(event) => setMetaDescription(event.target.value)}
            placeholder="A short description for search results"
            maxLength={160}
            disabled={loading}
            className="w-full border border-black/20 rounded-xl px-4 py-3 text-sm text-black placeholder:text-black/35 focus:outline-none focus:ring-1 focus:ring-black bg-white disabled:opacity-50"
          />
        </div>

        {errorMessage && (
          <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-3">
            {errorMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={!title.trim() || !content.trim() || loading}
          className="bg-black text-white text-sm px-6 py-3 rounded-xl hover:opacity-80 active:translate-y-px transition disabled:opacity-35"
        >
          {loading ? 'Saving draft...' : 'Save as draft'}
        </button>
      </form>
    </div>
  );
}
