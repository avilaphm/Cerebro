'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';

interface DraftPost {
  id: string;
  title: string;
  content_md: string;
  meta_description: string;
  slug: string;
  header_image_url: string | null;
  header_image_position: number;
  scheduled_at: string | null;
}

interface PublishedPost {
  id: string;
  title: string;
  slug: string;
  status: string;
  published_at: string | null;
  scheduled_at: string | null;
  social_drafts: { platform: string; status: string }[];
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default function BlogDashboardPage() {
  const supabase = createClient();

  const [drafts, setDrafts] = useState<DraftPost[]>([]);
  const [published, setPublished] = useState<PublishedPost[]>([]);
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState('');
  const [researchProgress, setResearchProgress] = useState(0);
  const [researchStep, setResearchStep] = useState('');
  const progressTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const [chatId, setChatId] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<Record<string, ChatMessage[]>>({});
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [scheduleValue, setScheduleValue] = useState('');
  const [posting, setPosting] = useState<string | null>(null);
  const [imagePosition, setImagePosition] = useState<Record<string, number>>({});
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [rescheduleValue, setRescheduleValue] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetId = useRef<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const loadPosts = useCallback(async () => {
    const { data } = await supabase
      .from('blog_posts')
      .select('id, title, slug, status, published_at, scheduled_at, content_md, meta_description, header_image_url, header_image_position, social_drafts(platform, status)')
      .in('status', ['research_draft', 'published', 'scheduled'])
      .order('created_at', { ascending: false })
      .limit(200);

    if (!data) return;

    const draftRows = data.filter((p: any) => p.status === 'research_draft') as DraftPost[];
    const publishedRows = data.filter((p: any) => p.status !== 'research_draft') as PublishedPost[];

    setDrafts(draftRows);
    setPublished(publishedRows);

    const contents: Record<string, string> = {};
    const positions: Record<string, number> = {};
    draftRows.forEach((d) => {
      contents[d.id] = d.content_md ?? '';
      positions[d.id] = d.header_image_position ?? 50;
    });
    setEditContent((prev) => ({ ...contents, ...prev }));
    setImagePosition((prev) => ({ ...positions, ...prev }));
  }, [supabase]);

  useEffect(() => { loadPosts(); }, [loadPosts]);

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, chatId]);

  function startProgressSimulation() {
    const steps = [
      { at: 0, pct: 5, label: 'Identifying what your audience is struggling with…' },
      { at: 4000, pct: 25, label: 'Analysing pain points and content angles…' },
      { at: 9000, pct: 50, label: 'Writing draft 1…' },
      { at: 14000, pct: 72, label: 'Writing draft 2…' },
      { at: 20000, pct: 88, label: 'Saving to your dashboard…' },
      { at: 25000, pct: 95, label: 'Almost done…' },
    ];
    progressTimersRef.current = steps.map(({ at, pct, label }) =>
      setTimeout(() => {
        setResearchProgress(pct);
        setResearchStep(label);
      }, at)
    );
  }

  function stopProgressSimulation() {
    progressTimersRef.current.forEach(clearTimeout);
    progressTimersRef.current = [];
  }

  async function handleResearch() {
    setResearching(true);
    setResearchError('');
    setResearchProgress(0);
    setResearchStep('Starting research…');
    startProgressSimulation();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('research-and-draft', {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error || data?.error) {
        setResearchError(data?.error ?? error?.message ?? 'Research failed. Try again.');
      } else {
        setResearchProgress(100);
        setResearchStep('Done.');
        await loadPosts();
      }
    } catch (e: any) {
      setResearchError(e.message ?? 'Research failed. Try again.');
    } finally {
      stopProgressSimulation();
      setResearching(false);
      setResearchProgress(0);
      setResearchStep('');
    }
  }

  async function handleSaveEdit(id: string) {
    setSaving(id);
    await supabase
      .from('blog_posts')
      .update({ content_md: editContent[id] })
      .eq('id', id);
    setSaving(null);
  }

  async function handleChat(id: string) {
    if (!chatInput.trim()) return;
    const message = chatInput.trim();
    setChatInput('');
    setChatLoading(true);

    const userMsg: ChatMessage = { role: 'user', content: message };
    setChatHistory((prev) => ({
      ...prev,
      [id]: [...(prev[id] ?? []), userMsg],
    }));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('refine-blog', {
        body: { blog_id: id, message, current_content: editContent[id] ?? '' },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (!error && data?.content) {
        setEditContent((prev) => ({ ...prev, [id]: data.content }));
        const assistantMsg: ChatMessage = { role: 'assistant', content: 'Done. Post updated.' };
        setChatHistory((prev) => ({
          ...prev,
          [id]: [...(prev[id] ?? []), assistantMsg],
        }));
      } else {
        const errMsg: ChatMessage = { role: 'assistant', content: 'Something went wrong. Try again.' };
        setChatHistory((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), errMsg] }));
      }
    } catch {
      const errMsg: ChatMessage = { role: 'assistant', content: 'Something went wrong. Try again.' };
      setChatHistory((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), errMsg] }));
    } finally {
      setChatLoading(false);
    }
  }

  async function handleImageUpload(file: File, postId: string) {
    const ext = file.name.split('.').pop() ?? 'jpg';
    const path = `${postId}/${Date.now()}.${ext}`;
    const { data: upload, error } = await supabase.storage
      .from('blog-headers')
      .upload(path, file, { cacheControl: '3600', upsert: true });
    if (error || !upload) return;
    const { data: { publicUrl } } = supabase.storage.from('blog-headers').getPublicUrl(upload.path);
    await supabase.from('blog_posts').update({ header_image_url: publicUrl }).eq('id', postId);
    setDrafts((prev) => prev.map((d) => d.id === postId ? { ...d, header_image_url: publicUrl } : d));
  }

  async function handleImagePosition(id: string, direction: 'up' | 'down') {
    const current = imagePosition[id] ?? 50;
    const next = Math.max(0, Math.min(100, current + (direction === 'down' ? 10 : -10)));
    setImagePosition((prev) => ({ ...prev, [id]: next }));
    await supabase.from('blog_posts').update({ header_image_position: next }).eq('id', id);
  }

  async function handlePostNow(id: string) {
    setPosting(id);
    const now = new Date().toISOString();
    await supabase
      .from('blog_posts')
      .update({ status: 'published', published_at: now, content_md: editContent[id] ?? undefined })
      .eq('id', id);

    // Auto-generate 5 X posts
    const { data: { session } } = await supabase.auth.getSession();
    await supabase.functions.invoke('generate-x-posts', {
      body: { blog_post_id: id, count: 5 },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    }).catch(() => {});

    setPosting(null);
    await loadPosts();
  }

  async function handleSchedule(id: string) {
    if (!scheduleValue) return;
    const offset = new Date().getTimezoneOffset();
    const local = new Date(new Date(scheduleValue).getTime() - offset * 60000);
    const scheduledAt = local.toISOString();
    await supabase
      .from('blog_posts')
      .update({ status: 'scheduled', scheduled_at: scheduledAt, content_md: editContent[id] ?? undefined })
      .eq('id', id);
    setSchedulingId(null);
    setScheduleValue('');
    await loadPosts();
  }

  async function handleDismiss(id: string) {
    await supabase.from('blog_posts').delete().eq('id', id);
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    if (expandedId === id) setExpandedId(null);
    if (chatId === id) setChatId(null);
  }

  async function handleReschedule(id: string) {
    if (!rescheduleValue) return;
    const offset = new Date().getTimezoneOffset();
    const local = new Date(new Date(rescheduleValue).getTime() - offset * 60000);
    const scheduledAt = local.toISOString();
    await supabase
      .from('blog_posts')
      .update({ scheduled_at: scheduledAt })
      .eq('id', id);
    setReschedulingId(null);
    setRescheduleValue('');
    await loadPosts();
  }

  async function handleMoveToDraft(id: string) {
    await supabase
      .from('blog_posts')
      .update({ status: 'research_draft', scheduled_at: null })
      .eq('id', id);
    await loadPosts();
  }

  function localDatetimeMin() {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  }

  const activeChatDraft = drafts.find((d) => d.id === chatId);

  return (
    <div className="p-8 relative">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black/40 mb-2">Dashboard</p>
          <h1 className="font-display text-3xl font-light tracking-[-0.02em] text-black">Blog</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleResearch}
            disabled={researching}
            className="flex items-center gap-2 border border-black/20 text-black text-sm px-5 py-2.5 rounded-xl hover:bg-black hover:text-white transition-colors disabled:opacity-40"
          >
            {researching ? (
              <>
                <span className="inline-block w-3.5 h-3.5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                Researching…
              </>
            ) : (
              <>
                <span className="text-base">◎</span> Research
              </>
            )}
          </button>
          <Link
            href="/dashboard/blog/new"
            className="bg-black text-white text-sm px-5 py-2.5 rounded-xl hover:opacity-80 transition-opacity"
          >
            New post
          </Link>
        </div>
      </div>

      {researchError && (
        <p className="text-xs text-red-600 mb-4">{researchError}</p>
      )}

      {researching && (
        <div className="mb-8 border border-black/10 rounded-xl p-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-black/60">{researchStep}</p>
            <p className="text-xs text-black/30">{researchProgress}%</p>
          </div>
          <div className="w-full h-1.5 bg-black/8 rounded-full overflow-hidden">
            <div
              className="h-full bg-black rounded-full transition-all duration-700 ease-out"
              style={{ width: `${researchProgress}%` }}
            />
          </div>
          <p className="text-xs text-black/30 mt-3">This takes about 30 seconds.</p>
        </div>
      )}

      {/* Draft Options */}
      {drafts.length > 0 && (
        <div className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-medium tracking-[0.15em] uppercase text-black/40">Draft options</p>
            <button
              onClick={() => drafts.forEach((d) => handleDismiss(d.id))}
              className="text-xs text-black/30 hover:text-red-500 transition-colors"
            >
              Dismiss all
            </button>
          </div>

          <div className="space-y-4">
            {drafts.map((draft) => {
              const isExpanded = expandedId === draft.id;
              const isScheduling = schedulingId === draft.id;
              const wordCount = (draft.content_md ?? '').split(/\s+/).filter(Boolean).length;
              const readTime = Math.ceil(wordCount / 200);

              return (
                <div
                  key={draft.id}
                  className="border border-black/10 rounded-xl overflow-hidden"
                >
                  {/* Card header */}
                  <div className="flex items-start justify-between p-5 gap-4">
                    <div className="flex-1 min-w-0">
                      {draft.header_image_url && (
                        <div className="relative w-full h-52 rounded-lg overflow-hidden mb-3 group">
                          <img
                            src={draft.header_image_url}
                            alt=""
                            className="w-full h-full object-cover"
                            style={{ objectPosition: `center ${imagePosition[draft.id] ?? 50}%` }}
                          />
                          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => handleImagePosition(draft.id, 'up')}
                              className="w-7 h-7 bg-white/90 hover:bg-white rounded-lg shadow flex items-center justify-center text-black text-xs font-medium transition-colors"
                              title="Move image up"
                            >
                              ↑
                            </button>
                            <button
                              onClick={() => handleImagePosition(draft.id, 'down')}
                              className="w-7 h-7 bg-white/90 hover:bg-white rounded-lg shadow flex items-center justify-center text-black text-xs font-medium transition-colors"
                              title="Move image down"
                            >
                              ↓
                            </button>
                          </div>
                        </div>
                      )}
                      <h3 className="font-display text-base font-medium text-black leading-snug mb-1.5">
                        {draft.title}
                      </h3>
                      <p className="text-sm text-black/50 leading-relaxed line-clamp-2">
                        {(draft.content_md ?? '').split('\n').find((l) => l.trim()) ?? ''}
                      </p>
                      <p className="text-xs text-black/30 mt-2">{readTime} min read · {wordCount.toLocaleString()} words</p>
                    </div>
                    <button
                      onClick={() => handleDismiss(draft.id)}
                      className="text-black/20 hover:text-red-400 transition-colors text-lg leading-none mt-0.5 flex-shrink-0"
                    >
                      ×
                    </button>
                  </div>

                  {/* Inline editor */}
                  {isExpanded && (
                    <div className="border-t border-black/10 px-5 pb-4 pt-3">
                      <textarea
                        value={editContent[draft.id] ?? ''}
                        onChange={(e) => setEditContent((prev) => ({ ...prev, [draft.id]: e.target.value }))}
                        onBlur={() => handleSaveEdit(draft.id)}
                        rows={20}
                        className="w-full text-sm font-mono text-black bg-black/2 border border-black/10 rounded-lg p-3 resize-y focus:outline-none focus:ring-1 focus:ring-black"
                      />
                      {saving === draft.id && (
                        <p className="text-xs text-black/30 mt-1">Saving…</p>
                      )}
                    </div>
                  )}

                  {/* Scheduling picker */}
                  {isScheduling && (
                    <div className="border-t border-black/10 px-5 py-3 flex items-center gap-3">
                      <input
                        type="datetime-local"
                        value={scheduleValue}
                        onChange={(e) => setScheduleValue(e.target.value)}
                        min={localDatetimeMin()}
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

                  {/* Action bar */}
                  <div className="border-t border-black/10 px-5 py-3 flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : draft.id)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                        isExpanded
                          ? 'bg-black text-white border-black'
                          : 'border-black/15 text-black/60 hover:border-black/40 hover:text-black'
                      }`}
                    >
                      {isExpanded ? 'Close' : 'Edit'}
                    </button>

                    <button
                      onClick={() => setChatId(chatId === draft.id ? null : draft.id)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                        chatId === draft.id
                          ? 'bg-black text-white border-black'
                          : 'border-black/15 text-black/60 hover:border-black/40 hover:text-black'
                      }`}
                    >
                      Chat
                    </button>

                    <button
                      onClick={() => {
                        uploadTargetId.current = draft.id;
                        fileInputRef.current?.click();
                      }}
                      className="text-xs px-3 py-1.5 rounded-lg border border-black/15 text-black/60 hover:border-black/40 hover:text-black transition-colors"
                    >
                      {draft.header_image_url ? '↺ Image' : '+ Image'}
                    </button>

                    <div className="flex-1" />

                    {!isScheduling && (
                      <button
                        onClick={() => { setSchedulingId(draft.id); setExpandedId(null); }}
                        className="text-xs px-3 py-1.5 rounded-lg border border-black/15 text-black/60 hover:border-black/40 hover:text-black transition-colors"
                      >
                        Schedule
                      </button>
                    )}

                    <button
                      onClick={() => handlePostNow(draft.id)}
                      disabled={posting === draft.id}
                      className="text-xs px-4 py-1.5 rounded-lg bg-black text-white hover:opacity-80 transition-opacity disabled:opacity-40"
                    >
                      {posting === draft.id ? 'Posting…' : 'Post now'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Published table */}
      <div>
        {drafts.length > 0 && (
          <p className="text-xs font-medium tracking-[0.15em] uppercase text-black/40 mb-4">Published</p>
        )}
        <div className="border border-black/10 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10">
                <th className="text-left px-5 py-3 text-xs font-medium tracking-wide text-black/40">Title</th>
                <th className="text-left px-5 py-3 text-xs font-medium tracking-wide text-black/40">Published</th>
                <th className="text-left px-5 py-3 text-xs font-medium tracking-wide text-black/40">Social</th>
                <th className="text-left px-5 py-3 text-xs font-medium tracking-wide text-black/40">View</th>
              </tr>
            </thead>
            <tbody>
              {published.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-black/30 text-sm">
                    No posts yet.{' '}
                    <button onClick={handleResearch} className="underline">
                      Research a topic
                    </button>{' '}
                    or{' '}
                    <Link href="/dashboard/blog/new" className="underline">
                      write one manually.
                    </Link>
                  </td>
                </tr>
              )}
              {published.map((post) => {
                const isScheduled = post.status === 'scheduled';
                const dateSource = isScheduled ? post.scheduled_at : post.published_at;
                const date = dateSource
                  ? new Date(dateSource).toLocaleDateString('en-AU', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })
                  : '—';
                const hasDrafts = post.social_drafts?.length > 0;
                const allPosted = hasDrafts && post.social_drafts.every((d) => d.status === 'posted');
                const isRescheduling = reschedulingId === post.id;

                return (
                  <>
                    <tr key={post.id} className="border-b border-black/5 hover:bg-black/[0.02] transition-colors">
                      <td className="px-5 py-3.5 text-black font-medium max-w-xs">
                        <span className="line-clamp-1">{post.title}</span>
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        {isScheduled ? (
                          <span className="text-black/40 text-xs">Scheduled · {date}</span>
                        ) : (
                          <span className="text-black/40">{date}</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        {hasDrafts ? (
                          <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${allPosted ? 'bg-black text-white' : 'bg-black/10 text-black/60'}`}>
                            {allPosted ? 'posted' : 'drafts ready'}
                          </span>
                        ) : (
                          <span className="text-black/20 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          {isScheduled ? (
                            <>
                              <button
                                onClick={() => {
                                  setReschedulingId(isRescheduling ? null : post.id);
                                  setRescheduleValue('');
                                }}
                                className="text-black/40 hover:text-black transition-colors text-xs"
                              >
                                {isRescheduling ? 'Cancel' : 'Reschedule'}
                              </button>
                              <button
                                onClick={() => handleMoveToDraft(post.id)}
                                className="text-black/40 hover:text-black transition-colors text-xs"
                              >
                                Edit
                              </button>
                            </>
                          ) : (
                            <Link
                              href={`/blog/${post.slug}`}
                              target="_blank"
                              className="text-black/40 hover:text-black transition-colors text-xs"
                            >
                              ↗ open
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isRescheduling && (
                      <tr key={`${post.id}-reschedule`} className="border-b border-black/5 bg-black/[0.01]">
                        <td colSpan={4} className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <input
                              type="datetime-local"
                              value={rescheduleValue}
                              onChange={(e) => setRescheduleValue(e.target.value)}
                              min={localDatetimeMin()}
                              className="text-sm border border-black/20 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-black"
                            />
                            <button
                              onClick={() => handleReschedule(post.id)}
                              disabled={!rescheduleValue}
                              className="bg-black text-white text-xs px-4 py-2 rounded-lg disabled:opacity-40 hover:opacity-80 transition-opacity"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => { setReschedulingId(null); setRescheduleValue(''); }}
                              className="text-xs text-black/40 hover:text-black transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Hidden file input for image upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const targetId = uploadTargetId.current;
          if (file && targetId) handleImageUpload(file, targetId);
          e.target.value = '';
        }}
      />

      {/* Chat panel */}
      {chatId && activeChatDraft && (
        <div className="fixed inset-y-0 right-0 w-96 bg-white border-l border-black/10 flex flex-col z-50 shadow-xl">
          <div className="flex items-center justify-between px-5 py-4 border-b border-black/10">
            <div>
              <p className="text-xs text-black/40 uppercase tracking-widest mb-0.5">Refine with AI</p>
              <p className="text-sm font-medium text-black line-clamp-1">{activeChatDraft.title}</p>
            </div>
            <button
              onClick={() => setChatId(null)}
              className="text-black/30 hover:text-black text-xl leading-none"
            >
              ×
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {(chatHistory[chatId] ?? []).length === 0 && (
              <div className="text-sm text-black/30 text-center mt-8">
                <p>Tell the AI what to change.</p>
                <p className="text-xs mt-2 text-black/20">e.g. "Make the hook sharper" · "Rewrite from the angle of a gym owner" · "Add more humor"</p>
              </div>
            )}
            {(chatHistory[chatId] ?? []).map((msg, i) => (
              <div
                key={i}
                className={`text-sm rounded-xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-black text-white ml-8'
                    : 'bg-black/5 text-black mr-8'
                }`}
              >
                {msg.content}
              </div>
            ))}
            {chatLoading && (
              <div className="bg-black/5 text-black/40 text-sm rounded-xl px-4 py-3 mr-8">
                Rewriting…
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="border-t border-black/10 px-4 py-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChat(chatId); } }}
                placeholder="What should change?"
                disabled={chatLoading}
                className="flex-1 text-sm border border-black/20 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-black disabled:opacity-40"
              />
              <button
                onClick={() => handleChat(chatId)}
                disabled={chatLoading || !chatInput.trim()}
                className="bg-black text-white text-xs px-4 py-2.5 rounded-lg disabled:opacity-40 hover:opacity-80 transition-opacity"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
