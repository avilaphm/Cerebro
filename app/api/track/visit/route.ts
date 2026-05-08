import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// Map a referrer hostname or utm_source to a normalized social channel.
function normalizeSource(utmSource: string | null, referrer: string | null): string {
  const u = utmSource?.toLowerCase().trim();
  if (u) {
    if (/(^|[._-])(ig|insta|instagram)([._-]|$)/.test(u)) return 'instagram';
    if (/(^|[._-])(yt|youtube)([._-]|$)/.test(u)) return 'youtube';
    if (/(^|[._-])(x|twitter)([._-]|$)/.test(u)) return 'x';
    if (/(^|[._-])(tt|tiktok)([._-]|$)/.test(u)) return 'tiktok';
    if (/(^|[._-])(li|linkedin)([._-]|$)/.test(u)) return 'linkedin';
    return u;
  }

  if (!referrer) return 'direct';
  let host = '';
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return 'other';
  }
  if (host.includes('instagram.com')) return 'instagram';
  if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
  if (host === 't.co' || host.includes('twitter.com') || host.includes('x.com')) return 'x';
  if (host.includes('tiktok.com')) return 'tiktok';
  if (host.includes('linkedin.com')) return 'linkedin';
  if (host.includes('google.') || host.includes('bing.com') || host.includes('duckduckgo.com')) return 'search';
  return host;
}

interface VisitBody {
  path?: string;
  referrer?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  session_id?: string | null;
}

export async function POST(req: NextRequest) {
  let body: VisitBody = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const path = (body.path ?? '/').slice(0, 256);
  const referrer = body.referrer?.slice(0, 1024) ?? null;
  const utm_source = body.utm_source?.slice(0, 128) ?? null;
  const utm_medium = body.utm_medium?.slice(0, 128) ?? null;
  const utm_campaign = body.utm_campaign?.slice(0, 128) ?? null;
  const utm_term = body.utm_term?.slice(0, 128) ?? null;
  const utm_content = body.utm_content?.slice(0, 128) ?? null;
  const session_id = body.session_id?.slice(0, 64) ?? null;
  const user_agent = req.headers.get('user-agent')?.slice(0, 512) ?? null;

  const source = normalizeSource(utm_source, referrer);

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    await supabase.from('page_visits').insert({
      path,
      referrer,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_term,
      utm_content,
      session_id,
      user_agent,
      source,
    });
  } catch {
    // Tracking should never break the page response
  }

  return NextResponse.json({ ok: true });
}
