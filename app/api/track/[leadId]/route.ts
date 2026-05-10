import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// 1×1 transparent GIF
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
  'base64',
);

const PIXEL_HEADERS = {
  'Content-Type': 'image/gif',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const { leadId } = await params;

  if (leadId) {
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      );
      // Legacy boolean (kept until Phase 2 backfill drops it).
      await supabase
        .from('leads')
        .update({ email_opened: true })
        .eq('id', leadId)
        .eq('email_opened', false);
      // Tag-based stage. The pixel currently lives only in the proposal email,
      // so an open here means email 2 was opened. Phase 2 will key the pixel
      // by send_id and write to a richer email_events table.
      await supabase
        .from('lead_tags')
        .upsert(
          { lead_id: leadId, tag_slug: 'email2_opened', source: 'webhook' },
          { onConflict: 'lead_id,tag_slug', ignoreDuplicates: true },
        );
    } catch {
      // Never fail the pixel response
    }
  }

  return new NextResponse(PIXEL, { status: 200, headers: PIXEL_HEADERS });
}
