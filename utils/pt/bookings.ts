export type PTBookingStatus =
  | 'scheduled'
  | 'confirmed'
  | 'cancellation_requested'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export type PTBookingSource = 'client' | 'coach' | 'recurring';
export type PTLedgerEntryType = 'pack_added' | 'booking_hold' | 'hold_released' | 'session_completed' | 'manual_adjustment';
export type PTCancellationRequestStatus = 'pending' | 'approved' | 'rejected';

export interface PTBookingAvailability {
  id: string;
  created_at: string;
  updated_at?: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  location: string | null;
  label: string | null;
  is_active: boolean;
}

export interface PTBookingAppointment {
  id: string;
  created_at: string;
  updated_at?: string;
  client_id: string;
  start_at: string;
  end_at: string;
  timezone: string;
  status: PTBookingStatus;
  source: PTBookingSource;
  recurring_group_id: string | null;
  google_calendar_event_id: string | null;
  location: string | null;
  notes: string | null;
  cancel_reason: string | null;
  cancellation_requested_at: string | null;
  confirmed_at: string | null;
  completed_at: string | null;
  completed_by: string | null;
  cancelled_at: string | null;
  created_by: string | null;
  pt_clients?: {
    id: string;
    name: string;
    email: string;
    sessions_remaining: number;
  } | null;
}

export interface PTBookingBlock {
  id: string;
  appointment_id: string | null;
  start_at: string;
  end_at: string;
  status: 'active' | 'cancelled';
}

export interface PTSessionLedgerEntry {
  id: string;
  created_at: string;
  client_id: string;
  appointment_id: string | null;
  entry_type: PTLedgerEntryType;
  quantity: number;
  balance_after: number | null;
  notes: string | null;
  created_by: string | null;
}

export interface PTBookingCancellationRequest {
  id: string;
  created_at: string;
  updated_at?: string;
  appointment_id: string;
  client_id: string;
  reason: string;
  status: PTCancellationRequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  pt_clients?: {
    name: string;
    email: string;
  } | null;
  pt_booking_appointments?: {
    start_at: string;
    end_at: string;
  } | null;
}

export interface PTBookableSlot {
  start_at: string;
  end_at: string;
  label: string;
  available: boolean;
  reason?: string;
  availability_id?: string;
  location?: string | null;
}

export const PT_BOOKING_TIMEZONE = 'Australia/Sydney';
export const PT_BOOKING_MIN_NOTICE_DAYS = 7;
export const PT_BOOKING_HORIZON_DAYS = 28;

export const ACTIVE_BOOKING_STATUSES: PTBookingStatus[] = ['scheduled', 'confirmed', 'cancellation_requested'];

export function pad(value: number) {
  return String(value).padStart(2, '0');
}

export function dateInputValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function formatBookingDate(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', weekday: 'short' });
}

export function formatBookingTime(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}

export function overlaps(startA: string | Date, endA: string | Date, startB: string | Date, endB: string | Date) {
  const aStart = typeof startA === 'string' ? new Date(startA).getTime() : startA.getTime();
  const aEnd = typeof endA === 'string' ? new Date(endA).getTime() : endA.getTime();
  const bStart = typeof startB === 'string' ? new Date(startB).getTime() : startB.getTime();
  const bEnd = typeof endB === 'string' ? new Date(endB).getTime() : endB.getTime();
  return aStart < bEnd && aEnd > bStart;
}

export function activeBookingHoldCount(bookings: Pick<PTBookingAppointment, 'status' | 'start_at'>[]) {
  const now = Date.now();
  return bookings.filter((booking) =>
    ACTIVE_BOOKING_STATUSES.includes(booking.status) && new Date(booking.start_at).getTime() > now,
  ).length;
}

export function availableSessionCredits(
  client: { sessions_remaining: number } | null,
  bookings: Pick<PTBookingAppointment, 'status' | 'start_at'>[],
) {
  if (!client) return 0;
  return Math.max(0, client.sessions_remaining - activeBookingHoldCount(bookings));
}
