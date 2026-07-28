'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import ResearchWorkspace from './ResearchWorkspace';

interface DraftPost {
  id: string;
  title: string;
  content_md: string;
  meta_description: string;
  slug: string;
  header_image_url: string | null;
  header_image_position: number;
  scheduled_at: string | null;
  research_context: string | null;
  qc_report: {
    deterministic_issues?: string[];
    refinement_issues?: string[];
    source_integrity_fixes?: string[];
  } | null;
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

interface LoadedPost extends DraftPost {
  status: string;
  published_at: string | null;
  social_drafts: { platform: string; status: string }[];
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface DraftSource {
  title: string;
  url: string;
  publisher: string;
  published_at: string | null;
  key_fact: string;
}

function parseDraftSources(context: string | null): DraftSource[] {
  if (!context) return [];
  try {
    const parsed = JSON.parse(context) as { sources?: DraftSource[] };
    return Array.isArray(parsed.sources) ? parsed.sources : [];
  } catch {
    return [];
  }
}

export default function BlogDashboardPage() {
  const supabase = createClient();

  const [drafts, setDrafts] = useState<DraftPost[]>([]);
  const [published, setPublished] = useState<PublishedPost[]>([]);
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
      .select('id, title, slug, status, published_at, scheduled_at, content_md, meta_description, header_image_url, header_image_position, research_context, qc_report, social_drafts(platform, status)')
      .in('status', ['research_draft', 'published', 'scheduled'])
      .order('created_at', { ascending: false })
      .limit(200);

    if (!data) return;

    const rows = data as unknown as LoadedPost[];
    const draftRows = rows.filter((post) => post.status === 'research_draft');
    const publishedRows = rows.filter((post) => post.status !== 'research_draft');

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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPosts();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadPosts]);

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, chatId]);

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
          <Link
            href="/dashboard/blog/new"
            className="bg-black text-white text-sm px-5 py-2.5 rounded-xl hover:opacity-80 transition-opacity"
          >
            New post
          </Link>
        </div>
      </div>

      <ResearchWorkspace
        onDraftCreated={async (postId) => {
          await loadPosts();
          setExpandedId(postId);
        }}
      />

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
              const sources = parseDraftSources(draft.research_context);
              const qcIssues = [
                ...(draft.qc_report?.deterministic_issues ?? []),
                ...(draft.qc_report?.refinement_issues ?? []),
              ];
              const qcFixes = draft.qc_report?.source_integrity_fixes ?? [];

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
                      <p className="text-xs text-black/30 mt-2">{readTime} min read / {wordCount.toLocaleString()} words</p>
                    </div>
                    <button
                      onClick={() => handleDismiss(draft.id)}
                      className="text-black/20 hover:text-red-400 transition-colors text-lg leading-none mt-0.5 flex-shrink-0"
                    >
                      ×
                    </button>
                  </div>

                  {(sources.length > 0 || qcIssues.length > 0 || qcFixes.length > 0) && (
                    <div className="border-t border-black/10 px-5 py-3 flex flex-col gap-2">
                      {sources.length > 0 && (
                        <details>
                          <summary className="text-xs text-black/50 hover:text-black cursor-pointer">
                            Research and sources ({sources.length})
                          </summary>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 pb-1">
                            {sources.map((source) => (
                              <div key={source.url} className="min-w-0">
                                <a
                                  href={source.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs font-medium text-black underline decoration-black/20 underline-offset-4 hover:decoration-black"
                                >
                                  {source.title}
                                </a>
                                <p className="text-[0.7rem] text-black/40 mt-1">
                                  {[source.publisher, source.published_at].filter(Boolean).join(' / ')}
                                </p>
                                {source.key_fact && (
                                  <p className="text-xs text-black/55 leading-relaxed mt-1.5">{source.key_fact}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                      {qcIssues.length > 0 && (
                        <details>
                          <summary className="text-xs text-amber-800 cursor-pointer">
                            Editorial checks still need attention ({qcIssues.length})
                          </summary>
                          <ul className="mt-2 space-y-1">
                            {qcIssues.map((issue) => (
                              <li key={issue} className="text-xs text-amber-900">{issue}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {qcFixes.length > 0 && (
                        <details>
                          <summary className="text-xs text-black/50 cursor-pointer">
                            Source-integrity corrections applied ({qcFixes.length})
                          </summary>
                          <ul className="mt-2 space-y-1">
                            {qcFixes.map((issue) => (
                              <li key={issue} className="text-xs text-black/55">{issue}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  )}

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
                    <a href="#blog-research" className="underline">
                      Research a topic
                    </a>{' '}
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
                  : 'Not set';
                const hasDrafts = post.social_drafts?.length > 0;
                const allPosted = hasDrafts && post.social_drafts.every((d) => d.status === 'posted');
                const isRescheduling = reschedulingId === post.id;

                return (
                  <Fragment key={post.id}>
                    <tr className="border-b border-black/5 hover:bg-black/[0.02] transition-colors">
                      <td className="px-5 py-3.5 text-black font-medium max-w-xs">
                        <span className="line-clamp-1">{post.title}</span>
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        {isScheduled ? (
                          <span className="text-black/40 text-xs">Scheduled / {date}</span>
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
                          <span className="text-black/20 text-xs">None</span>
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
                      <tr className="border-b border-black/5 bg-black/[0.01]">
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
                  </Fragment>
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
                <p className="text-xs mt-2 text-black/20">For example: &quot;Make the hook sharper&quot; or &quot;Make the example more concrete&quot;.</p>
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
