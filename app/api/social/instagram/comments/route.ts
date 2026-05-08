import { NextRequest, NextResponse } from 'next/server';

const GRAPH = 'https://graph.instagram.com/v21.0';

interface IGComment {
  id: string;
  text: string;
  username?: string;
  timestamp: string;
  like_count?: number;
}

export async function GET(req: NextRequest) {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const mediaId = req.nextUrl.searchParams.get('mediaId');

  if (!token) return NextResponse.json({ error: 'Instagram not configured' }, { status: 400 });
  if (!mediaId) return NextResponse.json({ error: 'mediaId required' }, { status: 400 });

  try {
    const res = await fetch(
      `${GRAPH}/${mediaId}/comments?fields=id,text,username,timestamp,like_count&limit=30&access_token=${token}`,
      { next: { revalidate: 300 } },
    );
    const data = await res.json();

    if (data.error) {
      return NextResponse.json({ error: data.error.message }, { status: 500 });
    }

    const comments = (data.data ?? []).map((c: IGComment) => ({
      id: c.id,
      author: c.username ?? 'Instagram user',
      text: c.text,
      likes: c.like_count ?? 0,
      publishedAt: c.timestamp,
    }));

    return NextResponse.json({ comments });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 });
  }
}
