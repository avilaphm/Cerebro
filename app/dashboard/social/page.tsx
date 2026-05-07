'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  status: string;
}

interface SocialDraft {
  id: string;
  created_at: string;
  platform: string;
  content: string;
  status: string;
  post_type: string | null;
  scheduled_at: string | null;
  tweet_id: string | null;
  posted_at: string | null;
  blog_post_id: string;
  blog_posts: { title: string; slug: string }[] | null;
}

const TYPE_LABELS: Record<string, string> = {
  hook: 'Hook',
  contrarian: 'Contrarian',
  specific: 'Specific',
  thread_opener: 'Thread opener',
  observation: 'Observation',
  single: 'Post',
};

export default function SocialPage() {
  const supabase = createClient();

  const [drafts, setDrafts] = useState<SocialDraft[]>([]);
  const [blogPosts, setBlogPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [selectedBlogId, setSelectedBlogId] = useState('');
  const [showBlogSelector, setShowBlogSelector] = useState(false);

  const [editContent, setEditContent] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [scheduleValue, setScheduleValue] = useState('');
  const [posting, setPosting] = useState<string | null>(null);
  const [postError, setPostError] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<'all' | 'twitter' | 'linkedin'>('twitter');
  const [generateCount, setGenerateCount] = useState<1 | 3 | 5>(5);

  const selectorRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    const [draftsRes, postsRes] = await Promise.all([
      supabase
        .from('social_drafts')
        .select('id, created_at, platform, content, status, post_type, scheduled_at, tweet_id, posted_at, blog_post_id, blog_posts(title, slug)')
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('blog_posts')
        .select('id, title, slug, status')
        .in('status', ['published', 'scheduled', 'research_draft'])
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    const draftRows = (draftsRes.data ?? []) as SocialDraft[];
    setDrafts(draftRows);
    setBlogPosts((postsRes.data ?? []) as BlogPost[]);

    const contents: Record<string, string> = {};
    draftRows.forEach((d) => { contents[d.id] = d.content; });
    setEditContent((prev) => ({ ...contents, ...prev }));
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  // Close blog selector on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node)) {
        setShowBlogSelector(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  async function handleGenerate() {
    if (!selectedBlogId || generating) return;
    setGenerating(true);
    setGenerateError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('generate-x-posts', {
        body: { blog_post_id: selectedBlogId, count: generateCount },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error || data?.error) {
        setGenerateError(data?.error ?? error?.message ?? 'Generation failed');
      } else {
        setShowBlogSelector(false);
        setSelectedBlogId('');
        await loadData();
      }
    } catch (e: unknown) {
      setGenerateError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  async function handleSaveEdit(id: string) {
    setSavingId(id);
    await supabase.from('social_drafts').update({ content: editContent[id] }).eq('id', id);
    setDrafts((prev) => prev.map((d) => d.id === id ? { ...d, content: editContent[id] } : d));
    setSavingId(null);
    setEditingId(null);
  }

  async function handleSchedule(id: string) {
    if (!scheduleValue) return;
    const scheduledAt = new Date(scheduleValue).toISOString();
    await supabase.from('social_drafts').update({ status: 'scheduled', scheduled_at: scheduledAt }).eq('id', id);
    setDrafts((prev) => prev.map((d) => d.id === id ? { ...d, status: 'scheduled', scheduled_at: scheduledAt } : d));
    setSchedulingId(null);
    setScheduleValue('');
  }

  async function handlePostNow(id: string) {
    setPosting(id);
    setPostError((prev) => { const n = { ...prev }; delete n[id]; return n; });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('post-to-x', {
        body: { draft_id: id },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error || data?.error) {
        setPostError((prev) => ({ ...prev, [id]: data?.error ?? error?.message ?? 'Post failed' }));
      } else {
        setDrafts((prev) => prev.map((d) =>
          d.id === id ? { ...d, status: 'posted', tweet_id: data.tweet_id ?? null, posted_at: new Date().toISOString() } : d,
        ));
      }
    } catch (e) {
      setPostError((prev) => ({ ...prev, [id]: e instanceof Error ? e.message : 'Post failed' }));
    } finally {
      setPosting(null);
    }
  }

  async function handleDelete(id: string) {
    await supabase.from('social_drafts').delete().eq('id', id);
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  }

  async function copyToClipboard(id: string, content: string) {
    await navigator.clipboard.writeText(content);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  const filtered = drafts.filter((d) => filter === 'all' || d.platform === filter);

  // Group by blog post
  const grouped = filtered.reduce<Record<string, SocialDraft[]>>((acc, d) => {
    const key = d.blog_post_id ?? 'unlinked';
    if (!acc[key]) acc[key] = [];
    acc[key].push(d);
    return acc;
  }, {});

  const blogPostMap = Object.fromEntries(blogPosts.map((p) => [p.id, p]));

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black/40 mb-2">Dashboard</p>
          <h1 className="font-display text-3xl font-light tracking-[-0.02em] text-black">Social</h1>
        </div>

        {/* Generate button + selector */}
        <div className="relative" ref={selectorRef}>
          <button
            onClick={() => setShowBlogSelector((v) => !v)}
            className="flex items-center gap-2 bg-black text-white text-sm px-5 py-2.5 rounded-xl hover:opacity-80 transition-opacity"
          >
            <span className="text-base">✦</span> Generate X posts
          </button>

          {showBlogSelector && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-black/10 rounded-xl shadow-xl z-50 overflow-hidden">
              <div className="p-3 border-b border-black/10">
                <p className="text-xs font-medium text-black/50 uppercase tracking-wide mb-2">Pick a blog post</p>
                <div className="space-y-1 max-h-52 overflow-y-auto">
                  {blogPosts.length === 0 && (
                    <p className="text-xs text-black/30 py-2">No blog posts found.</p>
                  )}
                  {blogPosts.map((post) => (
                    <button
                      key={post.id}
                      onClick={() => setSelectedBlogId(post.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                        selectedBlogId === post.id
                          ? 'bg-black text-white'
                          : 'hover:bg-black/5 text-black'
                      }`}
                    >
                      <span className="line-clamp-1">{post.title}</span>
                      <span className="text-xs opacity-50 mt-0.5 block">{post.status}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-3 space-y-2.5">
                <div>
                  <p className="text-xs font-medium text-black/50 uppercase tracking-wide mb-1.5">How many posts</p>
                  <div className="flex gap-1.5">
                    {([1, 3, 5] as const).map((n) => (
                      <button
                        key={n}
                        onClick={() => setGenerateCount(n)}
                        className={`flex-1 text-xs py-1.5 rounded-lg border transition-colors ${
                          generateCount === n
                            ? 'bg-black text-white border-black'
                            : 'border-black/20 text-black/60 hover:border-black/40'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                {generateError && <p className="text-xs text-red-500">{generateError}</p>}
                <button
                  onClick={handleGenerate}
                  disabled={!selectedBlogId || generating}
                  className="w-full bg-black text-white text-sm py-2.5 rounded-lg disabled:opacity-30 hover:opacity-80 transition-opacity flex items-center justify-center gap-2"
                >
                  {generating ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block" />
                      Generating…
                    </>
                  ) : `Generate ${generateCount} X post${generateCount > 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 mb-8">
        {(['twitter', 'linkedin', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              filter === f
                ? 'bg-black text-white border-black'
                : 'border-black/20 text-black/50 hover:border-black/40'
            }`}
          >
            {f === 'twitter' ? 'X' : f === 'linkedin' ? 'LinkedIn' : 'All'}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-black/30">Loading…</p>}

      {!loading && filtered.length === 0 && (
        <p className="text-sm text-black/30">
          No drafts yet. Click "Generate X posts" to create some from a blog post.
        </p>
      )}

      {/* Grouped by blog post */}
      <div className="space-y-10">
        {Object.entries(grouped).map(([blogPostId, groupDrafts]) => {
          const blogPost = blogPostMap[blogPostId] ?? groupDrafts[0]?.blog_posts?.[0];
          const title = (blogPost as { title?: string })?.title ?? 'Unknown post';

          return (
            <div key={blogPostId}>
              <p className="text-xs font-medium tracking-[0.12em] uppercase text-black/40 mb-3 truncate">
                {title}
              </p>

              <div className="space-y-3">
                {groupDrafts.map((draft) => {
                  const isEditing = editingId === draft.id;
                  const isScheduling = schedulingId === draft.id;
                  const charCount = (editContent[draft.id] ?? draft.content).length;
                  const isPosted = draft.status === 'posted';
                  const isScheduled = draft.status === 'scheduled';

                  return (
                    <div
                      key={draft.id}
                      className={`border rounded-xl overflow-hidden transition-opacity ${
                        isPosted ? 'opacity-40 border-black/5' : 'border-black/10'
                      }`}
                    >
                      {/* Card header */}
                      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-black/40 bg-black/5 px-2 py-0.5 rounded-full">
                            {TYPE_LABELS[draft.post_type ?? 'single'] ?? draft.post_type}
                          </span>
                          {isScheduled && draft.scheduled_at && (
                            <span className="text-xs text-black/30">
                              Scheduled · {new Date(draft.scheduled_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                            {isPosted && (
                            draft.tweet_id ? (
                              <a
                                href={`https://x.com/i/web/status/${draft.tweet_id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-black/30 hover:text-black transition-colors"
                              >
                                Posted ↗
                              </a>
                            ) : (
                              <span className="text-xs text-black/30">Posted</span>
                            )
                          )}
                        </div>
                        <button
                          onClick={() => handleDelete(draft.id)}
                          className="text-black/20 hover:text-red-400 transition-colors text-lg leading-none"
                        >
                          ×
                        </button>
                      </div>

                      {/* Content */}
                      <div className="px-4 pb-3">
                        {isEditing ? (
                          <textarea
                            value={editContent[draft.id] ?? ''}
                            onChange={(e) => setEditContent((prev) => ({ ...prev, [draft.id]: e.target.value }))}
                            rows={5}
                            className="w-full text-sm text-black bg-black/[0.02] border border-black/10 rounded-lg p-3 resize-y focus:outline-none focus:ring-1 focus:ring-black font-mono"
                          />
                        ) : (
                          <p className="text-sm text-black leading-relaxed whitespace-pre-wrap">
                            {editContent[draft.id] ?? draft.content}
                          </p>
                        )}
                        {draft.platform === 'twitter' && (
                          <p className={`text-xs mt-1 ${charCount > 280 ? 'text-red-500' : 'text-black/25'}`}>
                            {charCount} / 280
                          </p>
                        )}
                      </div>

                      {/* Scheduling picker */}
                      {isScheduling && (
                        <div className="border-t border-black/10 px-4 py-3 flex items-center gap-3">
                          <input
                            type="datetime-local"
                            value={scheduleValue}
                            onChange={(e) => setScheduleValue(e.target.value)}
                            min={new Date().toISOString().slice(0, 16)}
                            className="text-sm border border-black/20 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-black"
                          />
                          <button
                            onClick={() => handleSchedule(draft.id)}
                            disabled={!scheduleValue}
                            className="bg-black text-white text-xs px-4 py-2 rounded-lg disabled:opacity-40 hover:opacity-80 transition-opacity"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => { setSchedulingId(null); setScheduleValue(''); }}
                            className="text-xs text-black/40 hover:text-black transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      )}

                      {/* Actions */}
                      {!isPosted && (
                        <div className="border-t border-black/10 px-4 py-2.5 flex items-center gap-2 flex-wrap">
                          {isEditing ? (
                            <>
                              <button
                                onClick={() => handleSaveEdit(draft.id)}
                                disabled={savingId === draft.id}
                                className="text-xs px-3 py-1.5 rounded-lg bg-black text-white hover:opacity-80 transition-opacity disabled:opacity-40"
                              >
                                {savingId === draft.id ? 'Saving…' : 'Save'}
                              </button>
                              <button
                                onClick={() => { setEditingId(null); setEditContent((prev) => ({ ...prev, [draft.id]: draft.content })); }}
                                className="text-xs px-3 py-1.5 rounded-lg border border-black/15 text-black/60 hover:border-black/40 hover:text-black transition-colors"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => setEditingId(draft.id)}
                                className="text-xs px-3 py-1.5 rounded-lg border border-black/15 text-black/60 hover:border-black/40 hover:text-black transition-colors"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => copyToClipboard(draft.id, editContent[draft.id] ?? draft.content)}
                                className="text-xs px-3 py-1.5 rounded-lg border border-black/15 text-black/60 hover:border-black/40 hover:text-black transition-colors"
                              >
                                {copied === draft.id ? 'Copied!' : 'Copy'}
                              </button>
                              {!isScheduling && (
                                <button
                                  onClick={() => { setSchedulingId(draft.id); setScheduleValue(''); }}
                                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                                    isScheduled
                                      ? 'border-black/30 text-black/60 hover:border-black/50'
                                      : 'border-black/15 text-black/60 hover:border-black/40 hover:text-black'
                                  }`}
                                >
                                  {isScheduled ? 'Reschedule' : 'Schedule'}
                                </button>
                              )}
                              <div className="flex-1" />
                              {postError[draft.id] && (
                                <span className="text-xs text-red-500 max-w-[160px] truncate" title={postError[draft.id]}>
                                  {postError[draft.id]}
                                </span>
                              )}
                              <button
                                onClick={() => handlePostNow(draft.id)}
                                disabled={posting === draft.id}
                                className="text-xs px-3 py-1.5 rounded-lg bg-black text-white hover:opacity-80 transition-opacity disabled:opacity-40 flex items-center gap-1.5"
                              >
                                {posting === draft.id ? (
                                  <>
                                    <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block" />
                                    Posting…
                                  </>
                                ) : 'Post now'}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
