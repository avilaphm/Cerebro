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

// 3 daily slots in Sydney time (AEST UTC+10 — update offset to 11 during AEDT Oct–Apr)
const SYDNEY_OFFSET_MS = 10 * 3600 * 1000;
const SLOT_HOURS = [7.5, 12, 19]; // 7:30am · 12:00pm · 7:00pm
const DAY_MS = 86_400_000;

function buildScheduleQueue(afterUtc: Date, count: number): Date[] {
  const results: Date[] = [];
  // Work purely in numeric ms to avoid browser timezone interference with setHours
  const afterSydneyMs = afterUtc.getTime() + SYDNEY_OFFSET_MS;
  const dayMidnight = Math.floor(afterSydneyMs / DAY_MS) * DAY_MS;

  for (let day = 0; day < 60 && results.length < count; day++) {
    const dayMs = dayMidnight + day * DAY_MS;
    for (const slotH of SLOT_HOURS) {
      const slotSydneyMs = dayMs + slotH * 3_600_000;
      if (slotSydneyMs > afterSydneyMs + 60_000) {
        results.push(new Date(slotSydneyMs - SYDNEY_OFFSET_MS));
        if (results.length >= count) break;
      }
    }
  }

  return results;
}

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

  // Batch selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batching, setBatching] = useState(false);
  const [batchError, setBatchError] = useState('');

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

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node)) {
        setShowBlogSelector(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = drafts.filter((d) => filter === 'all' || d.platform === filter);

  const grouped = filtered.reduce<Record<string, SocialDraft[]>>((acc, d) => {
    const key = d.blog_post_id ?? 'unlinked';
    if (!acc[key]) acc[key] = [];
    acc[key].push(d);
    return acc;
  }, {});

  const blogPostMap = Object.fromEntries(blogPosts.map((p) => [p.id, p]));

  // Scheduled queue status
  const scheduledTwitter = drafts.filter(
    (d) => d.platform === 'twitter' && d.status === 'scheduled' && d.scheduled_at,
  );
  const lastScheduledAt = scheduledTwitter.length > 0
    ? new Date(Math.max(...scheduledTwitter.map((d) => new Date(d.scheduled_at!).getTime())))
    : null;

  // Only draft-status posts are selectable (not posted or already scheduled)
  const selectableIds = filtered
    .filter((d) => d.status === 'draft' && d.platform === 'twitter')
    .map((d) => d.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableIds));
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

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

  async function handleBatchPost() {
    if (selectedIds.size === 0 || batching) return;
    setBatching(true);
    setBatchError('');
    try {
      const ids = Array.from(selectedIds);
      const [firstId, ...restIds] = ids;

      // Start new queue after the last already-scheduled post
      const { data: lastScheduled } = await supabase
        .from('social_drafts')
        .select('scheduled_at')
        .eq('platform', 'twitter')
        .eq('status', 'scheduled')
        .order('scheduled_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const afterUtc = lastScheduled?.scheduled_at
        ? new Date(lastScheduled.scheduled_at)
        : new Date();

      // Post the first one immediately
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('post-to-x', {
        body: { draft_id: firstId },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error || data?.error) {
        setBatchError(data?.error ?? error?.message ?? 'Post failed');
        return;
      }
      setDrafts((prev) => prev.map((d) =>
        d.id === firstId
          ? { ...d, status: 'posted', tweet_id: data.tweet_id ?? null, posted_at: new Date().toISOString() }
          : d,
      ));

      // Schedule the rest — 3 per day, queued after existing scheduled posts
      if (restIds.length > 0) {
        const slots = buildScheduleQueue(afterUtc, restIds.length);
        await Promise.all(
          restIds.map((id, i) =>
            supabase.from('social_drafts')
              .update({ status: 'scheduled', scheduled_at: slots[i].toISOString() })
              .eq('id', id),
          ),
        );
        setDrafts((prev) => prev.map((d) => {
          const idx = restIds.indexOf(d.id);
          return idx === -1 ? d : { ...d, status: 'scheduled', scheduled_at: slots[idx].toISOString() };
        }));
      }

      setSelectedIds(new Set());
    } catch (e) {
      setBatchError(e instanceof Error ? e.message : 'Batch post failed');
    } finally {
      setBatching(false);
    }
  }

  async function handleDelete(id: string) {
    await supabase.from('social_drafts').delete().eq('id', id);
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }

  async function copyToClipboard(id: string, content: string) {
    await navigator.clipboard.writeText(content);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={`p-8 ${selectedIds.size > 0 ? 'pb-28' : ''}`}>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black/40 mb-2">Dashboard</p>
          <h1 className="font-display text-3xl font-light tracking-[-0.02em] text-black">Social</h1>
        </div>

        <div className="flex items-center gap-3">
          {/* Select all — only shown on X tab when there are draft posts */}
          {filter === 'twitter' && selectableIds.length > 0 && (
            <button
              onClick={toggleSelectAll}
              className={`text-xs px-3 py-2 rounded-lg border transition-colors ${
                allSelected
                  ? 'bg-black/5 border-black/25 text-black'
                  : 'border-black/15 text-black/40 hover:border-black/30 hover:text-black/60'
              }`}
            >
              {allSelected ? `${selectedIds.size} selected · deselect` : 'Select all'}
            </button>
          )}

          {/* Generate button + dropdown */}
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
                          selectedBlogId === post.id ? 'bg-black text-white' : 'hover:bg-black/5 text-black'
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
      </div>

      {/* Scheduled queue status banner */}
      {lastScheduledAt && (
        <div className="mb-6 flex items-center gap-2.5 bg-black/[0.025] border border-black/[0.07] rounded-xl px-4 py-3">
          <span className="w-1.5 h-1.5 rounded-full bg-black/30 flex-shrink-0" />
          <p className="text-xs text-black/50">
            <span className="font-medium text-black/70">
              {scheduledTwitter.length} post{scheduledTwitter.length !== 1 ? 's' : ''} scheduled
            </span>
            {' · '}until{' '}
            <span className="font-medium text-black/70">
              {lastScheduledAt.toLocaleDateString('en-AU', {
                day: 'numeric',
                month: 'long',
                timeZone: 'Australia/Sydney',
              })}
            </span>
            {' · '}3/day at 7:30am, 12pm &amp; 7pm
          </p>
        </div>
      )}

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
          No drafts yet. Click &ldquo;Generate X posts&rdquo; to create some from a blog post.
        </p>
      )}

      {/* Posts grouped by blog post */}
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
                  const isDraft = draft.status === 'draft';
                  const isSelected = selectedIds.has(draft.id);

                  return (
                    <div
                      key={draft.id}
                      className={`border rounded-xl overflow-hidden transition-all ${
                        isPosted
                          ? 'opacity-40 border-black/5'
                          : isSelected
                          ? 'border-black ring-1 ring-black/20'
                          : 'border-black/10'
                      }`}
                    >
                      {/* Card header */}
                      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
                        <div className="flex items-center gap-2">
                          {/* Checkbox — only for selectable draft posts */}
                          {isDraft && draft.platform === 'twitter' && (
                            <button
                              onClick={() => toggleSelect(draft.id)}
                              className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                                isSelected
                                  ? 'bg-black border-black'
                                  : 'border-black/25 hover:border-black/50'
                              }`}
                            >
                              {isSelected && (
                                <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                                  <path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </button>
                          )}

                          <span className="text-xs font-medium text-black/40 bg-black/5 px-2 py-0.5 rounded-full">
                            {TYPE_LABELS[draft.post_type ?? 'single'] ?? draft.post_type}
                          </span>

                          {isScheduled && draft.scheduled_at && (
                            <span className="text-xs text-black/30">
                              Scheduled · {new Date(draft.scheduled_at).toLocaleDateString('en-AU', {
                                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                                timeZone: 'Australia/Sydney',
                              })}
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

                      {/* Manual schedule picker */}
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

                      {/* Per-card actions */}
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
                                <span className="text-xs text-red-500 max-w-[200px] truncate" title={postError[draft.id]}>
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

      {/* Batch action bar — appears when posts are selected */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-sm border-t border-black/10 shadow-[0_-4px_32px_rgba(0,0,0,0.08)]">
          <div className="flex items-center justify-between px-8 py-4">
            <div>
              <p className="text-sm font-medium text-black">
                {selectedIds.size} post{selectedIds.size !== 1 ? 's' : ''} selected
              </p>
              {selectedIds.size > 1 && (
                <p className="text-xs text-black/40 mt-0.5">
                  1 posts now &middot; {selectedIds.size - 1} scheduled at 3/day (7:30am, 12pm, 7pm)
                  {' — '}queued after existing posts
                </p>
              )}
            </div>

            <div className="flex items-center gap-3">
              {batchError && (
                <span className="text-xs text-red-500 max-w-[220px] truncate" title={batchError}>
                  {batchError}
                </span>
              )}
              <button
                onClick={() => { setSelectedIds(new Set()); setBatchError(''); }}
                className="text-xs px-4 py-2 rounded-lg border border-black/20 text-black/60 hover:border-black/40 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleBatchPost}
                disabled={batching}
                className="text-xs px-5 py-2.5 rounded-xl bg-black text-white hover:opacity-80 transition-opacity disabled:opacity-40 flex items-center gap-2"
              >
                {batching ? (
                  <>
                    <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block" />
                    Posting…
                  </>
                ) : selectedIds.size === 1
                  ? 'Post now'
                  : `Post now + schedule ${selectedIds.size - 1}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
