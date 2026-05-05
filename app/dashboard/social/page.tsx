'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

interface Draft {
  id: string;
  created_at: string;
  platform: 'linkedin' | 'twitter';
  content: string;
  status: string;
  blog_posts: { title: string; slug: string }[] | null;
}

export default function SocialPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'linkedin' | 'twitter'>('all');

  const supabase = createClient();

  useEffect(() => {
    async function loadDrafts() {
      const { data } = await supabase
        .from('social_drafts')
        .select('id, created_at, platform, content, status, blog_posts(title, slug)')
        .order('created_at', { ascending: false })
        .limit(100);
      setDrafts((data ?? []) as Draft[]);
      setLoading(false);
    }
    loadDrafts();
  }, []);

  const markPosted = async (id: string) => {
    await supabase.from('social_drafts').update({ status: 'posted' }).eq('id', id);
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, status: 'posted' } : d)));
  };

  const copyToClipboard = async (id: string, content: string) => {
    await navigator.clipboard.writeText(content);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const filtered = filter === 'all' ? drafts : drafts.filter((d) => d.platform === filter);

  return (
    <div className="p-8">
      <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black/40 mb-2">
        Dashboard
      </p>
      <h1 className="font-display text-3xl font-light tracking-[-0.02em] text-black mb-8">
        Social drafts
      </h1>

      <div className="flex gap-2 mb-6">
        {(['all', 'linkedin', 'twitter'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              filter === f
                ? 'bg-black text-white border-black'
                : 'border-black/20 text-black/50 hover:border-black/40'
            }`}
          >
            {f === 'all' ? 'All' : f === 'linkedin' ? 'LinkedIn' : 'X'}
          </button>
        ))}
      </div>

      {loading && (
        <p className="text-sm text-black/30">Loading drafts…</p>
      )}

      {!loading && filtered.length === 0 && (
        <p className="text-sm text-black/30">
          No drafts yet. Publish a blog post and they will appear here.
        </p>
      )}

      <div className="space-y-4">
        {filtered.map((draft) => (
          <div
            key={draft.id}
            className={`border rounded-xl p-5 transition-opacity ${
              draft.status === 'posted' ? 'opacity-40 border-black/5' : 'border-black/10'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    draft.platform === 'linkedin'
                      ? 'bg-blue-50 text-blue-700'
                      : 'bg-black/8 text-black/60'
                  }`}
                >
                  {draft.platform === 'linkedin' ? 'LinkedIn' : 'X'}
                </span>
                {draft.blog_posts?.[0] && (
                  <span className="text-xs text-black/30 truncate max-w-xs">
                    from: {draft.blog_posts[0].title}
                  </span>
                )}
              </div>
              {draft.status === 'posted' && (
                <span className="text-xs text-black/30">Posted</span>
              )}
            </div>

            <p className="text-sm text-black leading-relaxed whitespace-pre-wrap mb-4">
              {draft.content}
            </p>

            {draft.status !== 'posted' && (
              <div className="flex gap-2">
                <button
                  onClick={() => copyToClipboard(draft.id, draft.content)}
                  className="text-xs border border-black/20 px-3 py-1.5 rounded-lg hover:bg-black hover:text-white hover:border-black transition-colors"
                >
                  {copied === draft.id ? 'Copied!' : 'Copy'}
                </button>
                <button
                  onClick={() => markPosted(draft.id)}
                  className="text-xs border border-black/20 px-3 py-1.5 rounded-lg hover:bg-black hover:text-white hover:border-black transition-colors"
                >
                  Mark as posted
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
