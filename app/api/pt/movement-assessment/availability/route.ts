import { NextResponse } from 'next/server';
import type { PTBookingAvailability, PTBookingBlock } from '@/utils/pt/bookings';
import { generateMovementAssessmentSlots, MOVEMENT_ASSESSMENT_SESSION_MINUTES } from '@/utils/pt/movement-assessment-booking';
import { createAdminClient } from '@/utils/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createAdminClient();
    const now = new Date();
    const rangeEnd = new Date(now.getTime() + 29 * 24 * 60 * 60 * 1000).toISOString();

    const [availabilityRes, blocksRes] = await Promise.all([
      supabase.from('pt_booking_availability').select('*').eq('is_active', true),
      supabase
        .from('pt_booking_blocks')
        .select('start_at, end_at, status')
        .eq('status', 'active')
        .lt('start_at', rangeEnd)
        .gt('end_at', now.toISOString()),
    ]);

    if (availabilityRes.error) throw availabilityRes.error;
    if (blocksRes.error) throw blocksRes.error;

    const slots = generateMovementAssessmentSlots(
      (availabilityRes.data ?? []) as PTBookingAvailability[],
      (blocksRes.data ?? []) as Pick<PTBookingBlock, 'start_at' | 'end_at' | 'status'>[],
      now,
    );

    return NextResponse.json({
      ok: true,
      session_minutes: MOVEMENT_ASSESSMENT_SESSION_MINUTES,
      slots,
    });
  } catch (error) {
    console.error('Movement assessment availability failed', error);
    return NextResponse.json({ ok: false, error: 'Could not load available times.' }, { status: 500 });
  }
}
