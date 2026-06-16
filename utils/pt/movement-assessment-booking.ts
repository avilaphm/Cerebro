import {
  formatBookingDate,
  formatBookingTime,
  overlaps,
  PT_BOOKING_HORIZON_DAYS,
  PT_BOOKING_MIN_NOTICE_HOURS,
  PT_BOOKING_TIMEZONE,
  type PTBookingAvailability,
  type PTBookingBlock,
} from './bookings';

export const MOVEMENT_ASSESSMENT_SESSION_MINUTES = 50;

export interface MovementAssessmentSlot {
  start_at: string;
  end_at: string;
  label: string;
  date_label: string;
  time_label: string;
  availability_id: string;
  location: string | null;
}

export function generateMovementAssessmentSlots(
  availability: PTBookingAvailability[],
  blocks: Pick<PTBookingBlock, 'start_at' | 'end_at' | 'status'>[],
  now = new Date(),
) {
  const minStart = new Date(now.getTime() + PT_BOOKING_MIN_NOTICE_HOURS * 60 * 60 * 1000);
  const maxStart = new Date(now.getTime() + PT_BOOKING_HORIZON_DAYS * 24 * 60 * 60 * 1000);
  const today = sydneyDateParts(now);
  const slots: MovementAssessmentSlot[] = [];

  for (let dayOffset = 0; dayOffset <= PT_BOOKING_HORIZON_DAYS; dayOffset += 1) {
    const day = addLocalDays(today, dayOffset);
    const dayOfWeek = dayOfWeekFromLocalDate(day);
    const windows = availability.filter((window) => window.is_active && window.day_of_week === dayOfWeek);

    for (const window of windows) {
      const startWindow = timeToMinutes(window.start_time);
      const endWindow = timeToMinutes(window.end_time);
      // Mirror the coach/client booking calendar exactly so the assessment shows
      // every slot Pedro actually has: session_duration_minutes long, stepped by
      // session + buffer, fitting a session within the window.
      const duration = sessionMinutes(window);
      const buffer = bufferMinutes(window);
      const step = duration + buffer;

      for (
        let minute = startWindow;
        minute + duration <= endWindow;
        minute += step
      ) {
        const start = zonedDateTimeToUtc(day, minute);
        const end = new Date(start.getTime() + duration * 60000);
        const blockedUntil = new Date(end.getTime() + buffer * 60000);

        if (start < minStart || start > maxStart) continue;
        if (blocks.some((block) => block.status === 'active' && overlaps(start, blockedUntil, block.start_at, block.end_at))) {
          continue;
        }

        slots.push({
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          label: `${formatBookingDate(start)} · ${formatBookingTime(start)}`,
          date_label: formatBookingDate(start),
          time_label: formatBookingTime(start),
          availability_id: window.id,
          location: window.location,
        });
      }
    }
  }

  return slots.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
}

export function findMovementAssessmentSlot(
  startAt: string,
  availability: PTBookingAvailability[],
  blocks: Pick<PTBookingBlock, 'start_at' | 'end_at' | 'status'>[],
  now = new Date(),
) {
  const requested = new Date(startAt).toISOString();
  return generateMovementAssessmentSlots(availability, blocks, now).find((slot) => slot.start_at === requested) ?? null;
}

export function assessmentBlockEnd(endAt: string, availability: PTBookingAvailability) {
  return new Date(new Date(endAt).getTime() + bufferMinutes(availability) * 60000).toISOString();
}

export function timeToMinutes(value: string) {
  const [hour, minute] = value.slice(0, 5).split(':').map(Number);
  return hour * 60 + minute;
}

function sessionMinutes(window: PTBookingAvailability) {
  return Number(window.session_duration_minutes ?? MOVEMENT_ASSESSMENT_SESSION_MINUTES);
}

function bufferMinutes(window: PTBookingAvailability) {
  const explicit = window.buffer_minutes;
  if (explicit !== null && explicit !== undefined && Number.isFinite(Number(explicit)) && Number(explicit) >= 0) {
    return Number(explicit);
  }
  return Math.max(0, Number(window.slot_duration_minutes ?? 0) - sessionMinutes(window));
}

function sydneyDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PT_BOOKING_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value),
    day: Number(parts.find((part) => part.type === 'day')?.value),
  };
}

function addLocalDays(date: { year: number; month: number; day: number }, days: number) {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function dayOfWeekFromLocalDate(date: { year: number; month: number; day: number }) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function zonedDateTimeToUtc(date: { year: number; month: number; day: number }, minuteOfDay: number) {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const utcGuess = new Date(Date.UTC(date.year, date.month - 1, date.day, hour, minute));
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PT_BOOKING_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(utcGuess);

  const renderedAsUtc = Date.UTC(
    Number(parts.find((part) => part.type === 'year')?.value),
    Number(parts.find((part) => part.type === 'month')?.value) - 1,
    Number(parts.find((part) => part.type === 'day')?.value),
    Number(parts.find((part) => part.type === 'hour')?.value),
    Number(parts.find((part) => part.type === 'minute')?.value),
  );
  const wantedAsUtc = Date.UTC(date.year, date.month - 1, date.day, hour, minute);

  return new Date(utcGuess.getTime() + wantedAsUtc - renderedAsUtc);
}
