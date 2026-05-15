import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

interface EventBody {
  event_type?: string;
  session_id?: string | null;
  source?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  path?: string | null;
}

export async function POST(req: NextRequest) {
  let body: EventBody = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const event_type = body.event_type?.slice(0, 64);
  if (!event_type) return NextResponse.json({ ok: false }, { status: 400 });

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    await supabase.from('site_events').insert({
      event_type,
      session_id: body.session_id?.slice(0, 64) ?? null,
      source: body.source?.slice(0, 64) ?? null,
      utm_source: body.utm_source?.slice(0, 128) ?? null,
      utm_medium: body.utm_medium?.slice(0, 128) ?? null,
      utm_campaign: body.utm_campaign?.slice(0, 128) ?? null,
      path: body.path?.slice(0, 256) ?? '/',
    });
  } catch {
    // Never break the page
  }

  return NextResponse.json({ ok: true });
}
