import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

interface DurationBody {
  session_id?: string | null;
  path?: string | null;
  duration_seconds?: number | null;
}

export async function POST(req: NextRequest) {
  let body: DurationBody = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const duration = typeof body.duration_seconds === 'number' && body.duration_seconds > 0
    ? Math.min(Math.round(body.duration_seconds), 86400)
    : null;
  if (!duration || !body.session_id) return NextResponse.json({ ok: true });

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    await supabase
      .from('page_visits')
      .update({ duration_seconds: duration })
      .eq('session_id', body.session_id.slice(0, 64))
      .eq('path', (body.path ?? '/').slice(0, 256))
      .is('duration_seconds', null);
  } catch {
    // best-effort
  }

  return NextResponse.json({ ok: true });
}
