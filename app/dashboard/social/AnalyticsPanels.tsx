'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

export interface YouTubeChannel {
  name: string;
  subscribers: number;
  totalViews: number;
  videoCount: number;
}

export interface YouTubeVideo {
  id: string;
  title: string;
  publishedAt: string;
  thumbnail?: string;
  views: number;
  likes: number;
  comments: number;
  duration: string;
}

export interface YouTubeData {
  connected: boolean;
  channel?: YouTubeChannel;
  videos?: YouTubeVideo[];
  error?: string;
}

export interface InstagramAccount {
  name: string;
  username?: string;
  followers: number;
  mediaCount: number;
}

export interface InstagramPost {
  id: string;
  caption: string;
  mediaType: string;
  timestamp: string;
  thumbnail?: string;
  likes: number;
  comments: number;
  impressions?: number;
  reach?: number;
  saves?: number;
  videoViews?: number;
  shares?: number;
}

export interface InstagramData {
  connected: boolean;
  account?: InstagramAccount;
  posts?: InstagramPost[];
  error?: string;
}

interface Comment {
  id: string;
  author: string;
  authorAvatar?: string;
  text: string;
  likes: number;
  publishedAt: string;
  replyCount?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return n.toString();
}

export function parseDuration(iso: string): string {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return '';
  const h = parseInt(match[1] ?? '0', 10);
  const m = parseInt(match[2] ?? '0', 10);
  const s = parseInt(match[3] ?? '0', 10);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// Strip basic HTML tags YouTube returns in comment text
function stripHtml(s: string): string {
  return s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
}

// ── Shared building blocks ───────────────────────────────────────────────────

function StatPill({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="border border-black/10 rounded-xl px-5 py-4">
      <p className="text-2xl font-display font-light text-black mb-0.5">{value}</p>
      <p className="text-xs text-black/40">{label}</p>
      {hint && <p className="text-[0.65rem] text-black/30 mt-1">{hint}</p>}
    </div>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black/[0.025] rounded-lg px-3 py-2">
      <p className="text-sm font-medium text-black">{value}</p>
      <p className="text-[0.65rem] tracking-[0.08em] uppercase text-black/40 mt-0.5">{label}</p>
    </div>
  );
}

function NotConnected({ platform, error, onRetry, retrying }: {
  platform: string;
  error?: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="border border-black/10 rounded-xl p-10 text-center max-w-md mx-auto mt-8">
      <p className="text-sm font-medium text-black mb-2">{platform} not connected</p>
      {error ? (
        <p className="text-xs text-red-400 leading-relaxed mb-4 font-mono break-all">{error}</p>
      ) : (
        <p className="text-xs text-black/40 leading-relaxed mb-4">
          Add your API credentials to{' '}
          <code className="text-black/60 bg-black/5 px-1.5 py-0.5 rounded">.env.local</code>{' '}
          and redeploy.
        </p>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          disabled={retrying}
          className="text-xs px-4 py-2 rounded-lg border border-black/20 text-black/60 hover:border-black/40 hover:text-black transition-colors disabled:opacity-40 flex items-center gap-2 mx-auto"
        >
          {retrying && <span className="w-3 h-3 border-2 border-black/30 border-t-black/70 rounded-full animate-spin inline-block" />}
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
      )}
    </div>
  );
}

function AnalyticsLoader() {
  return (
    <div className="space-y-4 mt-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-16 bg-black/[0.03] rounded-xl animate-pulse" />
      ))}
    </div>
  );
}

// ── Comments drawer ──────────────────────────────────────────────────────────

function CommentsList({ url, platform }: { url: string; platform: 'youtube' | 'instagram' }) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(url)
      .then(async (r) => {
        const data = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setError(data.error ?? 'Failed to load comments');
        } else {
          if (data.disabled) setDisabled(true);
          setComments(
            (data.comments ?? []).map((c: Comment) => ({
              ...c,
              text: platform === 'youtube' ? stripHtml(c.text) : c.text,
            })),
          );
        }
      })
      .catch(() => !cancelled && setError('Network error'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [url, platform]);

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-black/[0.03] rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-xs text-red-400">{error}</p>;
  }

  if (disabled) {
    return <p className="text-xs text-black/40">Comments are disabled on this video.</p>;
  }

  if (!comments || comments.length === 0) {
    return <p className="text-xs text-black/40">No comments yet.</p>;
  }

  return (
    <div className="space-y-3 max-h-80 overflow-y-auto pr-2">
      {comments.map((c) => (
        <div key={c.id} className="flex gap-3">
          {c.authorAvatar ? (
            <Image
              src={c.authorAvatar}
              alt={c.author}
              width={28}
              height={28}
              className="rounded-full flex-shrink-0"
              unoptimized
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-black/10 flex-shrink-0 flex items-center justify-center text-[0.65rem] font-medium text-black/50">
              {c.author.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-xs font-medium text-black">{c.author}</span>
              <span className="text-[0.65rem] text-black/30">{timeAgo(c.publishedAt)}</span>
            </div>
            <p className="text-xs text-black/70 leading-relaxed mt-0.5 whitespace-pre-wrap break-words">
              {c.text}
            </p>
            <div className="flex items-center gap-3 mt-1">
              {c.likes > 0 && (
                <span className="text-[0.65rem] text-black/40">{fmtNum(c.likes)} likes</span>
              )}
              {c.replyCount != null && c.replyCount > 0 && (
                <span className="text-[0.65rem] text-black/40">{c.replyCount} replies</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── YouTube panel ────────────────────────────────────────────────────────────

function YouTubeVideoRow({ video }: { video: YouTubeVideo }) {
  const [open, setOpen] = useState(false);

  const engagementRate =
    video.views > 0 ? ((video.likes + video.comments) / video.views) * 100 : 0;
  const likeRate = video.views > 0 ? (video.likes / video.views) * 100 : 0;

  return (
    <div className="border border-black/10 rounded-xl hover:border-black/20 transition-colors overflow-hidden">
      <div className="flex gap-4 p-4">
        {video.thumbnail && (
          <div className="flex-shrink-0 w-28 h-16 rounded-lg overflow-hidden bg-black/5 relative">
            <Image
              src={video.thumbnail}
              alt={video.title}
              fill
              className="object-cover"
              sizes="112px"
              unoptimized
            />
            {video.duration && (
              <span className="absolute bottom-1 right-1 text-[0.55rem] bg-black/70 text-white px-1 py-0.5 rounded">
                {parseDuration(video.duration)}
              </span>
            )}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <a
            href={`https://youtube.com/watch?v=${video.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-black font-medium line-clamp-2 hover:opacity-70 transition-opacity"
          >
            {video.title}
          </a>
          <p className="text-xs text-black/30 mt-1">{timeAgo(video.publishedAt)}</p>
          <div className="flex items-center gap-4 mt-2">
            <span className="text-xs text-black/50">{fmtNum(video.views)} views</span>
            <span className="text-xs text-black/30">{fmtNum(video.likes)} likes</span>
            <span className="text-xs text-black/30">{fmtNum(video.comments)} comments</span>
          </div>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-xs px-3 py-1.5 self-start rounded-lg border border-black/15 text-black/60 hover:border-black/40 hover:text-black transition-colors whitespace-nowrap"
          aria-expanded={open}
        >
          {open ? 'Hide' : 'Learn more'}
        </button>
      </div>

      {open && (
        <div className="border-t border-black/10 px-4 py-4 bg-black/[0.015]">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
            <MetricChip label="Views" value={fmtNum(video.views)} />
            <MetricChip label="Likes" value={fmtNum(video.likes)} />
            <MetricChip label="Comments" value={fmtNum(video.comments)} />
            <MetricChip label="Engagement" value={`${engagementRate.toFixed(2)}%`} />
            <MetricChip label="Like rate" value={`${likeRate.toFixed(2)}%`} />
            <MetricChip label="Duration" value={parseDuration(video.duration) || '—'} />
            <MetricChip label="Published" value={new Date(video.publishedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })} />
            <MetricChip label="Watch time" value="—" />
          </div>

          <p className="text-[0.65rem] tracking-[0.08em] uppercase text-black/40 mb-3">
            Top comments
          </p>
          <CommentsList url={`/api/social/youtube/comments?videoId=${video.id}`} platform="youtube" />

          <p className="text-[0.6rem] text-black/30 mt-4 leading-relaxed">
            Watch time, retention, and CTR require the YouTube Analytics API (OAuth). Wire that up next when ready.
          </p>
        </div>
      )}
    </div>
  );
}

export function YouTubePanel({ data, loading, onRetry }: { data: YouTubeData | null; loading: boolean; onRetry: () => void }) {
  if (loading) return <AnalyticsLoader />;
  if (!data || !data.connected) {
    return <NotConnected platform="YouTube" error={data?.error} onRetry={onRetry} retrying={loading} />;
  }

  const { channel, videos = [] } = data;

  return (
    <div>
      {channel && (
        <div className="grid grid-cols-3 gap-3 mb-8">
          <StatPill label="Subscribers" value={fmtNum(channel.subscribers)} />
          <StatPill label="Total views" value={fmtNum(channel.totalViews)} />
          <StatPill label="Videos" value={fmtNum(channel.videoCount)} />
        </div>
      )}

      <p className="text-xs font-medium tracking-[0.12em] uppercase text-black/40 mb-4">
        Recent videos
      </p>

      {videos.length === 0 ? (
        <p className="text-sm text-black/30">No videos found.</p>
      ) : (
        <div className="space-y-3">
          {videos.map((v) => <YouTubeVideoRow key={v.id} video={v} />)}
        </div>
      )}
    </div>
  );
}

// ── Instagram panel ──────────────────────────────────────────────────────────

function InstagramPostRow({ post, followers }: { post: InstagramPost; followers?: number }) {
  const [open, setOpen] = useState(false);

  const engagementBase = post.reach ?? followers ?? 0;
  const engagementRate =
    engagementBase > 0
      ? ((post.likes + post.comments + (post.saves ?? 0)) / engagementBase) * 100
      : 0;

  return (
    <div className="border border-black/10 rounded-xl hover:border-black/20 transition-colors overflow-hidden">
      <div className="flex gap-4 p-4">
        {post.thumbnail && (
          <div className="flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-black/5 relative">
            <Image
              src={post.thumbnail}
              alt={post.caption.slice(0, 40) || 'Post'}
              fill
              className="object-cover"
              sizes="64px"
              unoptimized
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          {post.caption ? (
            <p className="text-sm text-black line-clamp-2 leading-relaxed">{post.caption}</p>
          ) : (
            <p className="text-sm text-black/30 italic">{post.mediaType.toLowerCase()}</p>
          )}
          <p className="text-xs text-black/30 mt-1">{timeAgo(post.timestamp)}</p>
          <div className="flex items-center gap-4 mt-2 flex-wrap">
            <span className="text-xs text-black/50">{fmtNum(post.likes)} likes</span>
            <span className="text-xs text-black/30">{fmtNum(post.comments)} comments</span>
            {post.saves != null && (
              <span className="text-xs text-black/30">{fmtNum(post.saves)} saves</span>
            )}
            {post.reach != null && (
              <span className="text-xs text-black/30">{fmtNum(post.reach)} reach</span>
            )}
          </div>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-xs px-3 py-1.5 self-start rounded-lg border border-black/15 text-black/60 hover:border-black/40 hover:text-black transition-colors whitespace-nowrap"
          aria-expanded={open}
        >
          {open ? 'Hide' : 'Learn more'}
        </button>
      </div>

      {open && (
        <div className="border-t border-black/10 px-4 py-4 bg-black/[0.015]">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
            <MetricChip label="Likes" value={fmtNum(post.likes)} />
            <MetricChip label="Comments" value={fmtNum(post.comments)} />
            <MetricChip label="Saves" value={post.saves != null ? fmtNum(post.saves) : '—'} />
            <MetricChip label="Shares" value={post.shares != null ? fmtNum(post.shares) : '—'} />
            <MetricChip label="Reach" value={post.reach != null ? fmtNum(post.reach) : '—'} />
            <MetricChip label="Impressions" value={post.impressions != null ? fmtNum(post.impressions) : '—'} />
            <MetricChip label="Video views" value={post.videoViews != null ? fmtNum(post.videoViews) : '—'} />
            <MetricChip label="Engagement" value={engagementRate > 0 ? `${engagementRate.toFixed(2)}%` : '—'} />
          </div>

          <p className="text-[0.65rem] tracking-[0.08em] uppercase text-black/40 mb-3">
            Recent comments
          </p>
          <CommentsList url={`/api/social/instagram/comments?mediaId=${post.id}`} platform="instagram" />

          <p className="text-[0.6rem] text-black/30 mt-4 leading-relaxed">
            Engagement rate based on {post.reach != null ? 'reach' : 'follower count'}. Saves and shares are the strongest growth signals — watch them more than likes.
          </p>
        </div>
      )}
    </div>
  );
}

export function InstagramPanel({ data, loading, onRetry }: { data: InstagramData | null; loading: boolean; onRetry: () => void }) {
  if (loading) return <AnalyticsLoader />;
  if (!data || !data.connected) {
    return <NotConnected platform="Instagram" error={data?.error} onRetry={onRetry} retrying={loading} />;
  }

  const { account, posts = [] } = data;

  return (
    <div>
      {account && (
        <div className="grid grid-cols-2 gap-3 mb-8">
          <StatPill label="Followers" value={fmtNum(account.followers)} />
          <StatPill label="Total posts" value={fmtNum(account.mediaCount)} />
        </div>
      )}

      <p className="text-xs font-medium tracking-[0.12em] uppercase text-black/40 mb-4">
        Recent posts
      </p>

      {posts.length === 0 ? (
        <p className="text-sm text-black/30">No posts found.</p>
      ) : (
        <div className="space-y-3">
          {posts.map((p) => <InstagramPostRow key={p.id} post={p} followers={account?.followers} />)}
        </div>
      )}
    </div>
  );
}

// ── TikTok placeholder ───────────────────────────────────────────────────────

export function TikTokPanel() {
  return (
    <div className="border border-black/10 rounded-xl p-10 text-center max-w-md mx-auto mt-8">
      <p className="text-sm font-medium text-black mb-2">TikTok coming soon</p>
      <p className="text-xs text-black/40 leading-relaxed">
        Requires a TikTok Business account and Display API approval (1–2 weeks). Once approved, this tab will show views, average watch time, completion rate, shares, and comments.
      </p>
    </div>
  );
}

// ── X placeholder ────────────────────────────────────────────────────────────

export function XAnalyticsNote() {
  return (
    <div className="mb-6 border border-black/10 rounded-xl p-4 bg-black/[0.015]">
      <p className="text-xs text-black/60 leading-relaxed">
        <span className="font-medium text-black">X analytics not connected.</span>{' '}
        Impressions, profile clicks, and link clicks require the X API Basic tier (~$200/mo).
        Until then, track outbound clicks via UTM tags on links you post.
      </p>
    </div>
  );
}
