import { NextResponse } from 'next/server';

const YT = 'https://www.googleapis.com/youtube/v3';

function toInt(v: unknown): number {
  return parseInt(String(v ?? '0'), 10) || 0;
}

export async function GET() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const channelId = process.env.YOUTUBE_CHANNEL_ID;

  if (!apiKey || !channelId) {
    return NextResponse.json({ connected: false });
  }

  try {
    const [channelRes, searchRes] = await Promise.all([
      fetch(`${YT}/channels?part=statistics,snippet&id=${channelId}&key=${apiKey}`),
      fetch(`${YT}/search?part=snippet&channelId=${channelId}&type=video&order=date&maxResults=10&key=${apiKey}`),
    ]);

    const [channelData, searchData] = await Promise.all([channelRes.json(), searchRes.json()]);

    if (channelData.error) {
      return NextResponse.json({ connected: false, error: channelData.error.message });
    }

    if (!channelData.items?.length) {
      return NextResponse.json({ connected: false, error: 'Channel not found' });
    }

    const ch = channelData.items[0];
    const videoIds = (searchData.items ?? [])
      .map((v: { id: { videoId?: string } }) => v.id?.videoId)
      .filter(Boolean)
      .join(',');

    let videos: unknown[] = [];
    if (videoIds) {
      const videosRes = await fetch(
        `${YT}/videos?part=statistics,snippet,contentDetails&id=${videoIds}&key=${apiKey}`
      );
      const videosData = await videosRes.json();
      videos = (videosData.items ?? []).map((v: {
        id: string;
        snippet: { title: string; publishedAt: string; thumbnails?: { medium?: { url: string }; default?: { url: string } } };
        statistics: { viewCount?: string; likeCount?: string; commentCount?: string };
        contentDetails?: { duration?: string };
      }) => ({
        id: v.id,
        title: v.snippet.title,
        publishedAt: v.snippet.publishedAt,
        thumbnail: v.snippet.thumbnails?.medium?.url ?? v.snippet.thumbnails?.default?.url,
        views: toInt(v.statistics.viewCount),
        likes: toInt(v.statistics.likeCount),
        comments: toInt(v.statistics.commentCount),
        duration: v.contentDetails?.duration ?? '',
      }));
    }

    return NextResponse.json({
      connected: true,
      channel: {
        name: ch.snippet.title,
        subscribers: toInt(ch.statistics.subscriberCount),
        totalViews: toInt(ch.statistics.viewCount),
        videoCount: toInt(ch.statistics.videoCount),
      },
      videos,
    });
  } catch {
    return NextResponse.json({ connected: false, error: 'Failed to fetch YouTube data' });
  }
}
