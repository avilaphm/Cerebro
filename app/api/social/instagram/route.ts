import { NextResponse } from 'next/server';

// Instagram Business Login API uses graph.instagram.com (not graph.facebook.com)
const GRAPH = 'https://graph.instagram.com/v21.0';

interface MediaItem {
  id: string;
  caption?: string;
  media_type: string;
  timestamp: string;
  thumbnail_url?: string;
  media_url?: string;
  like_count?: number;
  comments_count?: number;
}

interface InsightMetric {
  name: string;
  values?: { value: number }[];
  value?: number;
}

export async function GET() {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;

  if (!token) {
    return NextResponse.json({ connected: false });
  }

  try {
    // Use /me — Business Login tokens identify the user directly
    const [accountRes, mediaRes] = await Promise.all([
      fetch(`${GRAPH}/me?fields=followers_count,media_count,name,username&access_token=${token}`),
      fetch(`${GRAPH}/me/media?fields=id,caption,media_type,timestamp,like_count,comments_count,thumbnail_url,media_url&limit=20&access_token=${token}`),
    ]);

    const [accountData, mediaData] = await Promise.all([accountRes.json(), mediaRes.json()]);

    if (accountData.error) {
      return NextResponse.json({ connected: false, error: accountData.error.message });
    }

    const posts = (mediaData.data ?? []).map((p: MediaItem) => ({
      id: p.id,
      caption: (p.caption ?? '').slice(0, 150),
      mediaType: p.media_type,
      timestamp: p.timestamp,
      thumbnail: p.thumbnail_url ?? p.media_url,
      likes: p.like_count ?? 0,
      comments: p.comments_count ?? 0,
    }));

    // Fetch insights (requires instagram_business_manage_insights permission)
    const postsWithInsights = await Promise.all(
      posts.slice(0, 12).map(async (post: {
        id: string;
        mediaType: string;
        [key: string]: unknown;
      }) => {
        try {
          const metrics = ['impressions', 'reach', 'saved'];
          if (post.mediaType === 'VIDEO' || post.mediaType === 'REELS') {
            metrics.push('video_views', 'shares');
          }
          const insightsRes = await fetch(
            `${GRAPH}/${post.id}/insights?metric=${metrics.join(',')}&access_token=${token}`
          );
          const insightsData = await insightsRes.json();
          if (!insightsData.error && insightsData.data) {
            const m: Record<string, number> = {};
            (insightsData.data as InsightMetric[]).forEach((metric) => {
              m[metric.name] = metric.values?.[0]?.value ?? metric.value ?? 0;
            });
            return {
              ...post,
              impressions: m.impressions,
              reach: m.reach,
              saves: m.saved,
              videoViews: m.video_views,
              shares: m.shares,
            };
          }
        } catch {
          // insights not available — return base metrics only
        }
        return post;
      })
    );

    return NextResponse.json({
      connected: true,
      account: {
        name: accountData.name,
        username: accountData.username,
        followers: accountData.followers_count,
        mediaCount: accountData.media_count,
      },
      posts: postsWithInsights,
    });
  } catch {
    return NextResponse.json({ connected: false, error: 'Failed to fetch Instagram data' });
  }
}
