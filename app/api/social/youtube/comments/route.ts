import { NextRequest, NextResponse } from 'next/server';

const YT = 'https://www.googleapis.com/youtube/v3';

interface YTCommentItem {
  snippet: {
    topLevelComment: {
      id: string;
      snippet: {
        authorDisplayName: string;
        authorProfileImageUrl?: string;
        textDisplay: string;
        likeCount: number;
        publishedAt: string;
      };
    };
    totalReplyCount: number;
  };
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const videoId = req.nextUrl.searchParams.get('videoId');

  if (!apiKey) return NextResponse.json({ error: 'YouTube API key not configured' }, { status: 400 });
  if (!videoId) return NextResponse.json({ error: 'videoId required' }, { status: 400 });

  try {
    const res = await fetch(
      `${YT}/commentThreads?part=snippet&videoId=${videoId}&order=relevance&maxResults=20&key=${apiKey}`,
      { next: { revalidate: 300 } },
    );
    const data = await res.json();

    if (data.error) {
      // Comments disabled is a normal case, not a failure
      if (data.error.code === 403) {
        return NextResponse.json({ comments: [], disabled: true });
      }
      return NextResponse.json({ error: data.error.message }, { status: 500 });
    }

    const comments = (data.items ?? []).map((item: YTCommentItem) => {
      const c = item.snippet.topLevelComment.snippet;
      return {
        id: item.snippet.topLevelComment.id,
        author: c.authorDisplayName,
        authorAvatar: c.authorProfileImageUrl,
        text: c.textDisplay,
        likes: c.likeCount,
        publishedAt: c.publishedAt,
        replyCount: item.snippet.totalReplyCount,
      };
    });

    return NextResponse.json({ comments });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 });
  }
}
