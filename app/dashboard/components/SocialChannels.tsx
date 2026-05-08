'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import Link from 'next/link';

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return n.toString();
}

interface Metric {
  label: string;
  value: string | number;
}

interface PlatformCardProps {
  name: string;
  connected: boolean;
  loading: boolean;
  metrics?: Metric[];
  comingSoon?: boolean;
}

function PlatformCard({ name, connected, loading, metrics, comingSoon }: PlatformCardProps) {
  return (
    <div className="border border-black/10 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-medium tracking-[0.12em] uppercase text-black">{name}</p>
        {comingSoon ? (
          <span className="text-[0.6rem] px-2 py-0.5 rounded-full bg-black/5 text-black/30 tracking-wide uppercase">
            Soon
          </span>
        ) : connected ? (
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
        ) : (
          <Link
            href="/dashboard/social"
            className="text-[0.6rem] text-black/30 hover:text-black/50 transition-colors"
          >
            Connect →
          </Link>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          <div className="h-3 w-16 bg-black/5 rounded animate-pulse" />
          <div className="h-3 w-12 bg-black/5 rounded animate-pulse" />
        </div>
      ) : connected && metrics?.length ? (
        <div className="space-y-2">
          {metrics.map((m) => (
            <div key={m.label} className="flex items-baseline justify-between gap-4">
              <p className="text-xs text-black/40 truncate">{m.label}</p>
              <p className="text-sm font-light text-black flex-shrink-0">{m.value}</p>
            </div>
          ))}
        </div>
      ) : !comingSoon ? (
        <p className="text-xs text-black/25">Not connected</p>
      ) : null}
    </div>
  );
}

interface YouTubeData {
  connected: boolean;
  channel?: { name: string; subscribers: number; totalViews: number; videoCount: number };
}

interface InstagramData {
  connected: boolean;
  account?: { name: string; followers: number; mediaCount: number };
}

export default function SocialChannels() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [xPosted, setXPosted] = useState(0);
  const [xScheduled, setXScheduled] = useState(0);
  const [youtube, setYoutube] = useState<YouTubeData | null>(null);
  const [instagram, setInstagram] = useState<InstagramData | null>(null);

  useEffect(() => {
    async function load() {
      const [postedRes, scheduledRes, ytRes, igRes] = await Promise.all([
        supabase
          .from('social_drafts')
          .select('*', { count: 'exact', head: true })
          .eq('platform', 'twitter')
          .eq('status', 'posted'),
        supabase
          .from('social_drafts')
          .select('*', { count: 'exact', head: true })
          .eq('platform', 'twitter')
          .eq('status', 'scheduled'),
        fetch('/api/social/youtube').then((r) => r.json()).catch(() => ({ connected: false })),
        fetch('/api/social/instagram').then((r) => r.json()).catch(() => ({ connected: false })),
      ]);

      setXPosted(postedRes.count ?? 0);
      setXScheduled(scheduledRes.count ?? 0);
      setYoutube(ytRes as YouTubeData);
      setInstagram(igRes as InstagramData);
      setLoading(false);
    }
    load();
  }, [supabase]);

  return (
    <div className="mb-12">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-medium tracking-[0.15em] uppercase text-black/40">
          Social channels
        </p>
        <Link
          href="/dashboard/social"
          className="text-xs text-black/30 hover:text-black/60 transition-colors"
        >
          Manage →
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <PlatformCard
          name="X"
          connected
          loading={loading}
          metrics={[
            { label: 'Posts live', value: fmtNum(xPosted) },
            { label: 'Scheduled', value: fmtNum(xScheduled) },
          ]}
        />
        <PlatformCard
          name="YouTube"
          connected={!loading && (youtube?.connected ?? false)}
          loading={loading}
          metrics={
            youtube?.channel
              ? [
                  { label: 'Subscribers', value: fmtNum(youtube.channel.subscribers) },
                  { label: 'Total views', value: fmtNum(youtube.channel.totalViews) },
                ]
              : []
          }
        />
        <PlatformCard
          name="Instagram"
          connected={!loading && (instagram?.connected ?? false)}
          loading={loading}
          metrics={
            instagram?.account
              ? [
                  { label: 'Followers', value: fmtNum(instagram.account.followers) },
                  { label: 'Posts', value: fmtNum(instagram.account.mediaCount) },
                ]
              : []
          }
        />
        <PlatformCard name="TikTok" connected={false} loading={false} comingSoon />
      </div>
    </div>
  );
}
