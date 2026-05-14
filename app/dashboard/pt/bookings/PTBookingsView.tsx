'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import type { PTClient } from '@/utils/pt/types';
import type {
  PTBookingAppointment,
  PTBookingAvailability,
  PTBookingCancellationRequest,
  PTBookingStatus,
} from '@/utils/pt/bookings';
import { formatBookingDate, formatBookingTime } from '@/utils/pt/bookings';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FIELD_CLASS = 'w-full border border-black/10 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-black/35 disabled:opacity-40';
const ACTIVE_STATUSES: PTBookingStatus[] = ['scheduled', 'confirmed', 'cancellation_requested'];
type BookingCalendarView = 'day' | 'week' | 'month';
const COACH_CALENDAR_START_HOUR = 6;
const COACH_CALENDAR_END_HOUR = 18;
const COACH_HOUR_HEIGHT = 72;

function todayInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function addDaysInput(days: number) {
  const next = new Date();
  next.setDate(next.getDate() + days);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateKey(value: Date | string) {
  const date = typeof value === 'string' ? new Date(value) : value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function startOfWeek(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() - value.getDay());
  return value;
}

function calendarOffsetMinutes(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value;
  return (date.getHours() - COACH_CALENDAR_START_HOUR) * 60 + date.getMinutes();
}

export default function PTBookingsView() {
  const supabase = createClient();
  const [clients, setClients] = useState<PTClient[]>([]);
  const [availability, setAvailability] = useState<PTBookingAvailability[]>([]);
  const [appointments, setAppointments] = useState<PTBookingAppointment[]>([]);
  const [requests, setRequests] = useState<PTBookingCancellationRequest[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [windowDraft, setWindowDraft] = useState({
    day_of_week: '1',
    start_time: '06:00',
    end_time: '13:00',
    slot_duration_minutes: '50',
    session_duration_minutes: '45',
    buffer_minutes: '5',
    location: '',
    label: '',
  });
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const date = new Date();
    date.setDate(1);
    return date;
  });
  const [calendarView, setCalendarView] = useState<BookingCalendarView>('week');
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [selectedAppointment, setSelectedAppointment] = useState<PTBookingAppointment | null>(null);
  const [bookingDraft, setBookingDraft] = useState({
    client_id: '',
    start_at: `${addDaysInput(2)}T07:00`,
    recurring_weeks: '1',
  });
  const [packDraft, setPackDraft] = useState({
    client_id: '',
    sessions: '10',
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    const rangeStart = todayInputValue();
    const rangeEnd = addDaysInput(35);
    const [clientsRes, availabilityRes, appointmentsRes, requestsRes] = await Promise.all([
      supabase.from('pt_clients').select('*').neq('status', 'archived').order('name', { ascending: true }),
      supabase.from('pt_booking_availability').select('*').order('day_of_week').order('start_time'),
      supabase
        .from('pt_booking_appointments')
        .select('*, pt_clients(id, name, email, sessions_remaining)')
        .gte('start_at', `${rangeStart}T00:00:00`)
        .lt('start_at', `${rangeEnd}T00:00:00`)
        .order('start_at', { ascending: true }),
      supabase
        .from('pt_booking_cancellation_requests')
        .select('*, pt_clients(name, email), pt_booking_appointments(start_at, end_at)')
        .eq('status', 'pending')
        .order('created_at', { ascending: true }),
    ]);

    if (clientsRes.error) setStatus(clientsRes.error.message);
    if (availabilityRes.error) setStatus(availabilityRes.error.message);
    if (appointmentsRes.error) setStatus(appointmentsRes.error.message);
    if (requestsRes.error) setStatus(requestsRes.error.message);

    const clientRows = (clientsRes.data ?? []) as PTClient[];
    setClients(clientRows);
    setAvailability((availabilityRes.data ?? []) as PTBookingAvailability[]);
    setAppointments((appointmentsRes.data ?? []) as PTBookingAppointment[]);
    setRequests((requestsRes.data ?? []) as PTBookingCancellationRequest[]);
    setBookingDraft((current) => ({ ...current, client_id: current.client_id || clientRows[0]?.id || '' }));
    setPackDraft((current) => ({ ...current, client_id: current.client_id || clientRows[0]?.id || '' }));
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const nextAppointments = useMemo(
    () => appointments.filter((appointment) => ACTIVE_STATUSES.includes(appointment.status)).slice(0, 12),
    [appointments],
  );
  const appointmentsByDate = useMemo(() => {
    const map = new Map<string, PTBookingAppointment[]>();
    appointments
      .filter((appointment) => ACTIVE_STATUSES.includes(appointment.status))
      .forEach((appointment) => {
        const key = dateKey(appointment.start_at);
        map.set(key, [...(map.get(key) ?? []), appointment]);
      });
    map.forEach((items) => items.sort((a, b) => a.start_at.localeCompare(b.start_at)));
    return map;
  }, [appointments]);
  const calendarDays = useMemo(() => {
    const first = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [calendarMonth]);
  const calendarWeekDays = useMemo(() => {
    const start = startOfWeek(calendarDate);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }, [calendarDate]);
  const lowCreditClients = clients.filter((client) => client.sessions_remaining <= 2).sort((a, b) => a.sessions_remaining - b.sessions_remaining);

  const addAvailability = async () => {
    setBusy('availability');
    const { error } = await supabase.from('pt_booking_availability').insert({
      day_of_week: Number(windowDraft.day_of_week),
      start_time: windowDraft.start_time,
      end_time: windowDraft.end_time,
      slot_duration_minutes: Number(windowDraft.slot_duration_minutes),
      session_duration_minutes: Number(windowDraft.session_duration_minutes),
      buffer_minutes: Number(windowDraft.buffer_minutes),
      location: windowDraft.location.trim() || null,
      label: windowDraft.label.trim() || null,
      is_active: true,
    });
    setStatus(error ? error.message : 'Availability added.');
    if (!error) {
      setWindowDraft((current) => ({ ...current, label: '' }));
      await loadData();
    }
    setBusy(null);
  };

  const toggleAvailability = async (row: PTBookingAvailability) => {
    const { error } = await supabase
      .from('pt_booking_availability')
      .update({ is_active: !row.is_active, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    setStatus(error ? error.message : row.is_active ? 'Availability disabled.' : 'Availability enabled.');
    if (!error) await loadData();
  };

  const deleteAvailability = async (id: string) => {
    const { error } = await supabase.from('pt_booking_availability').delete().eq('id', id);
    setStatus(error ? error.message : 'Availability deleted.');
    if (!error) await loadData();
  };

  const addPack = async () => {
    const client = clients.find((item) => item.id === packDraft.client_id);
    const sessions = Number(packDraft.sessions);
    if (!client || !Number.isFinite(sessions) || sessions <= 0) return;
    setBusy('pack');
    const nextBalance = client.sessions_remaining + sessions;
    const [{ error: clientError }, { error: ledgerError }] = await Promise.all([
      supabase.from('pt_clients').update({ sessions_remaining: nextBalance, updated_at: new Date().toISOString() }).eq('id', client.id),
      supabase.from('pt_session_ledger').insert({
        client_id: client.id,
        entry_type: 'pack_added',
        quantity: sessions,
        balance_after: nextBalance,
        notes: `${sessions} session pack added by Pedro.`,
      }),
    ]);
    setStatus(clientError?.message ?? ledgerError?.message ?? 'Session pack added.');
    if (!clientError && !ledgerError) await loadData();
    setBusy(null);
  };

  const createManualBooking = async () => {
    if (!bookingDraft.client_id || !bookingDraft.start_at) return;
    setBusy('booking');
    const { data, error } = await supabase.functions.invoke<{ error?: string }>('manage-pt-booking', {
      body: {
        action: 'create',
        client_id: bookingDraft.client_id,
        start_at: new Date(bookingDraft.start_at).toISOString(),
        recurring_weeks: Number(bookingDraft.recurring_weeks),
      },
    });
    setStatus(error?.message ?? data?.error ?? 'Booking created.');
    if (!error && !data?.error) await loadData();
    setBusy(null);
  };

  const cancelAppointment = async (appointmentId: string) => {
    setBusy(appointmentId);
    const { data, error } = await supabase.functions.invoke<{ error?: string }>('manage-pt-booking', {
      body: { action: 'cancel', appointment_id: appointmentId, reason: 'Cancelled by Pedro.' },
    });
    setStatus(error?.message ?? data?.error ?? 'Booking cancelled.');
    if (!error && !data?.error) await loadData();
    setBusy(null);
  };

  const completeAppointment = async (appointmentId: string) => {
    setBusy(appointmentId);
    const { data, error } = await supabase.functions.invoke<{ error?: string }>('manage-pt-booking', {
      body: { action: 'complete', appointment_id: appointmentId },
    });
    setStatus(error?.message ?? data?.error ?? 'Session completed and deducted.');
    if (!error && !data?.error) await loadData();
    setBusy(null);
  };

  const reviewRequest = async (appointmentId: string, approved: boolean) => {
    setBusy(appointmentId);
    const { data, error } = await supabase.functions.invoke<{ error?: string }>('manage-pt-booking', {
      body: { action: 'review_cancellation', appointment_id: appointmentId, approved },
    });
    setStatus(error?.message ?? data?.error ?? (approved ? 'Cancellation approved.' : 'Cancellation rejected.'));
    if (!error && !data?.error) await loadData();
    setBusy(null);
  };

  const moveCalendar = (direction: -1 | 1) => {
    setSelectedAppointment(null);
    if (calendarView === 'month') {
      setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + direction, 1));
      return;
    }
    setCalendarDate((current) => addDays(current, calendarView === 'week' ? direction * 7 : direction));
  };

  const calendarTitle =
    calendarView === 'day'
      ? calendarDate.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' })
      : calendarView === 'week'
        ? `${formatBookingDate(calendarWeekDays[0])} - ${formatBookingDate(calendarWeekDays[6])}`
        : calendarMonth.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });

  const renderAppointmentBlock = (appointment: PTBookingAppointment, compact = false) => {
    const duration = Math.max(25, (new Date(appointment.end_at).getTime() - new Date(appointment.start_at).getTime()) / 60000);
    const top = Math.max(0, (calendarOffsetMinutes(appointment.start_at) / 60) * COACH_HOUR_HEIGHT);
    const height = Math.max(36, (duration / 60) * COACH_HOUR_HEIGHT);
    const isRequest = appointment.status === 'cancellation_requested';

    return (
      <button
        key={appointment.id}
        type="button"
        onClick={() => setSelectedAppointment(appointment)}
        style={{ top, height }}
        className={`absolute inset-x-1 overflow-hidden border px-2 py-1 text-left transition-colors ${
          selectedAppointment?.id === appointment.id
            ? 'border-black bg-black text-white'
            : isRequest
              ? 'border-amber-300 bg-amber-100 text-amber-900'
              : 'border-black/10 bg-white text-black shadow-[0_12px_22px_-20px_rgba(0,0,0,0.55)] hover:border-black/35'
        }`}
      >
        <span className={`block truncate font-medium ${compact ? 'text-[0.72rem]' : 'text-sm'}`}>
          {appointment.pt_clients?.name ?? 'Client'}
        </span>
        {!compact && (
          <span className="mt-0.5 block truncate text-xs opacity-70">
            {formatBookingTime(appointment.start_at)} - {formatBookingTime(appointment.end_at)}
          </span>
        )}
      </button>
    );
  };

  const renderCoachCalendarRail = (days: Date[]) => (
    <div className="mt-5 overflow-x-auto border border-black/10 bg-white">
      <div className="min-w-[48rem]">
        <div className="grid border-b border-black/10" style={{ gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))` }}>
          <div className="bg-[#fbfbf8]" />
          {days.map((day) => {
            const isToday = dateKey(day) === todayInputValue();
            return (
              <div key={dateKey(day)} className="border-l border-black/10 bg-[#fbfbf8] px-3 py-3 text-center">
                <p className="text-[0.65rem] uppercase tracking-[0.12em] text-black/35">{day.toLocaleDateString('en-AU', { weekday: 'short' })}</p>
                <p className={`mx-auto mt-1 flex h-8 w-8 items-center justify-center rounded-full text-lg font-light ${isToday ? 'bg-black text-white' : 'text-black/70'}`}>
                  {day.getDate()}
                </p>
              </div>
            );
          })}
        </div>
        <div
          className="grid"
          style={{
            gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))`,
            height: (COACH_CALENDAR_END_HOUR - COACH_CALENDAR_START_HOUR) * COACH_HOUR_HEIGHT,
          }}
        >
          <div className="relative bg-white">
            {Array.from({ length: COACH_CALENDAR_END_HOUR - COACH_CALENDAR_START_HOUR + 1 }, (_, index) => {
              const hour = COACH_CALENDAR_START_HOUR + index;
              return (
                <div key={hour} className="absolute right-2 -translate-y-1/2 text-xs text-black/35" style={{ top: index * COACH_HOUR_HEIGHT }}>
                  {new Date(2026, 0, 1, hour).toLocaleTimeString('en-AU', { hour: 'numeric' })}
                </div>
              );
            })}
          </div>
          {days.map((day) => {
            const key = dateKey(day);
            const dayAppointments = appointmentsByDate.get(key) ?? [];
            return (
              <div key={key} className="relative border-l border-black/10">
                {Array.from({ length: COACH_CALENDAR_END_HOUR - COACH_CALENDAR_START_HOUR + 1 }, (_, index) => (
                  <div key={index} className="absolute inset-x-0 border-t border-black/10" style={{ top: index * COACH_HOUR_HEIGHT }} />
                ))}
                {dayAppointments.map((appointment) => renderAppointmentBlock(appointment, days.length > 1))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f7f7f3] px-5 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <div className="max-w-7xl">
        <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">PT Dashboard</p>
            <h1 className="mt-1 font-display text-3xl font-light tracking-[-0.02em]">Bookings</h1>
          </div>
          <button type="button" onClick={() => void loadData()} className="inline-flex w-full items-center justify-center gap-2 border border-black/10 bg-white px-3 py-3 text-xs text-black/55 hover:border-black/30 sm:w-auto sm:py-2">
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        {status && (
          <div className="mb-5 flex flex-col gap-3 border border-black/10 bg-white px-4 py-3 text-sm text-black/60 sm:flex-row sm:items-center sm:justify-between">
            <span>{status}</span>
            <button type="button" onClick={() => setStatus('')} className="text-black/35 hover:text-black" aria-label="Dismiss status">
              <X size={16} />
            </button>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-black/40">Loading bookings...</p>
        ) : (
          <>
            <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Upcoming" value={String(nextAppointments.length)} />
              <Metric label="Pending cancels" value={String(requests.length)} alert={requests.length > 0} />
              <Metric label="Low credits" value={String(lowCreditClients.length)} alert={lowCreditClients.length > 0} />
              <Metric label="Availability" value={String(availability.filter((item) => item.is_active).length)} />
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
              <section className="space-y-6">
                <div className="border border-black/10 bg-white p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                    <div>
                      <p className="text-[0.6rem] uppercase tracking-[0.18em] text-black/35">Calendar</p>
                      <h2 className="mt-1 text-lg font-medium">{calendarTitle}</h2>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="grid w-full grid-cols-3 border border-black/10 bg-[#fbfbf8] p-1 sm:w-auto">
                        {(['day', 'week', 'month'] as BookingCalendarView[]).map((view) => (
                          <button
                            key={view}
                            type="button"
                            onClick={() => {
                              setCalendarView(view);
                              setSelectedAppointment(null);
                            }}
                            className={`px-3 py-2 text-xs font-medium uppercase tracking-[0.08em] transition-colors ${
                              calendarView === view ? 'bg-black text-white' : 'text-black/45 hover:text-black'
                            }`}
                          >
                            {view}
                          </button>
                        ))}
                      </div>
                      <button type="button" onClick={() => moveCalendar(-1)} className="inline-flex h-10 w-10 items-center justify-center border border-black/10 text-black/45 hover:border-black/30 hover:text-black" aria-label="Previous calendar range">
                        <ChevronLeft size={16} />
                      </button>
                      <button type="button" onClick={() => moveCalendar(1)} className="inline-flex h-10 w-10 items-center justify-center border border-black/10 text-black/45 hover:border-black/30 hover:text-black" aria-label="Next calendar range">
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>

                  {calendarView === 'day' ? (
                    renderCoachCalendarRail([calendarDate])
                  ) : calendarView === 'week' ? (
                    renderCoachCalendarRail(calendarWeekDays)
                  ) : (
                    <div className="mt-5 grid grid-cols-7 border-l border-t border-black/10">
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                        <div key={day} className="border-b border-r border-black/10 px-2 py-2 text-center text-[0.6rem] uppercase tracking-[0.12em] text-black/35">
                          {day}
                        </div>
                      ))}
                      {calendarDays.map((day) => {
                        const key = dateKey(day);
                        const dayAppointments = appointmentsByDate.get(key) ?? [];
                        const inMonth = day.getMonth() === calendarMonth.getMonth();
                        return (
                          <div key={key} className={`min-h-24 border-b border-r border-black/10 p-1.5 sm:min-h-32 sm:p-2 ${inMonth ? 'bg-[#fbfbf8]' : 'bg-white text-black/25'}`}>
                            <div className="mb-2 flex items-center justify-between">
                              <span className="text-xs font-medium">{day.getDate()}</span>
                              {dayAppointments.length > 0 && <Clock size={13} className="text-black/35" />}
                            </div>
                            <div className="space-y-1">
                              {dayAppointments.slice(0, 5).map((appointment) => (
                                <button
                                  key={appointment.id}
                                  type="button"
                                  onClick={() => setSelectedAppointment(appointment)}
                                  className={`w-full truncate px-2 py-1 text-left text-[0.68rem] font-medium ${
                                    appointment.status === 'cancellation_requested'
                                      ? 'bg-amber-100 text-amber-900'
                                      : 'bg-white text-black'
                                  }`}
                                >
                                  {formatBookingTime(appointment.start_at)} · {appointment.pt_clients?.name ?? 'Client'}
                                </button>
                              ))}
                              {dayAppointments.length > 5 && <p className="text-[0.65rem] text-black/35">+{dayAppointments.length - 5} more</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {selectedAppointment && (
                    <div className="mt-5 border border-black/10 bg-[#fbfbf8] p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-medium">{selectedAppointment.pt_clients?.name ?? 'Client'}</p>
                          <p className="mt-1 text-xs text-black/45">
                            {formatBookingDate(selectedAppointment.start_at)} · {formatBookingTime(selectedAppointment.start_at)} - {formatBookingTime(selectedAppointment.end_at)}
                          </p>
                          <p className="mt-1 text-xs text-black/45">
                            {selectedAppointment.status.replace(/_/g, ' ')}{selectedAppointment.location ? ` · ${selectedAppointment.location}` : ''}
                          </p>
                        </div>
                        <button type="button" onClick={() => setSelectedAppointment(null)} className="text-xs text-black/35 underline-offset-2 hover:text-black hover:underline">
                          Close
                        </button>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button type="button" onClick={() => void completeAppointment(selectedAppointment.id)} disabled={busy === selectedAppointment.id} className="border border-black bg-black px-3 py-2 text-xs text-white hover:bg-white hover:text-black disabled:opacity-40">
                          Mark done
                        </button>
                        <button type="button" onClick={() => void cancelAppointment(selectedAppointment.id)} disabled={busy === selectedAppointment.id} className="border border-black/10 bg-white px-3 py-2 text-xs text-black/55 hover:border-red-300 hover:text-red-700 disabled:opacity-40">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {requests.length > 0 && (
                  <div className="border border-amber-200 bg-amber-50 p-4">
                    <p className="text-[0.6rem] uppercase tracking-[0.18em] text-amber-700">Late cancellation requests</p>
                    <div className="mt-4 space-y-2">
                      {requests.map((request) => (
                        <div key={request.id} className="border border-amber-200 bg-white px-4 py-3">
                          <p className="text-sm font-medium">{request.pt_clients?.name ?? 'Client'}</p>
                          <p className="mt-1 text-xs text-black/45">
                            {request.pt_booking_appointments ? `${formatBookingDate(request.pt_booking_appointments.start_at)} · ${formatBookingTime(request.pt_booking_appointments.start_at)}` : 'Session'}
                          </p>
                          <p className="mt-2 text-sm text-black/60">{request.reason}</p>
                          <div className="mt-3 flex gap-2">
                            <button type="button" onClick={() => void reviewRequest(request.appointment_id, true)} className="border border-black bg-black px-3 py-2 text-xs text-white hover:bg-white hover:text-black">
                              Approve
                            </button>
                            <button type="button" onClick={() => void reviewRequest(request.appointment_id, false)} className="border border-black/10 bg-white px-3 py-2 text-xs text-black/55 hover:border-black/30">
                              Reject
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              <aside className="space-y-6">
                <Panel title="Manual booking" eyebrow="Pedro">
                  <FormLabel label="Client">
                    <select value={bookingDraft.client_id} onChange={(event) => setBookingDraft((current) => ({ ...current, client_id: event.target.value }))} className={FIELD_CLASS}>
                      {clients.map((client) => <option key={client.id} value={client.id}>{client.name} ({client.sessions_remaining})</option>)}
                    </select>
                  </FormLabel>
                  <FormLabel label="Start">
                    <input type="datetime-local" value={bookingDraft.start_at} onChange={(event) => setBookingDraft((current) => ({ ...current, start_at: event.target.value }))} className={FIELD_CLASS} />
                  </FormLabel>
                  <FormLabel label="Weekly repeats inside 28 days">
                    <select value={bookingDraft.recurring_weeks} onChange={(event) => setBookingDraft((current) => ({ ...current, recurring_weeks: event.target.value }))} className={FIELD_CLASS}>
                      <option value="1">One session</option>
                      <option value="2">2 weeks</option>
                      <option value="3">3 weeks</option>
                      <option value="4">4 weeks</option>
                    </select>
                  </FormLabel>
                  <button type="button" onClick={() => void createManualBooking()} disabled={busy === 'booking'} className="mt-3 inline-flex w-full items-center justify-center gap-2 border border-black bg-black px-4 py-3 text-sm text-white hover:bg-white hover:text-black disabled:opacity-40">
                    <CalendarDays size={16} />
                    {busy === 'booking' ? 'Booking...' : 'Book session'}
                  </button>
                </Panel>

                <Panel title="Session pack" eyebrow="Credits">
                  <FormLabel label="Client">
                    <select value={packDraft.client_id} onChange={(event) => setPackDraft((current) => ({ ...current, client_id: event.target.value }))} className={FIELD_CLASS}>
                      {clients.map((client) => <option key={client.id} value={client.id}>{client.name} ({client.sessions_remaining})</option>)}
                    </select>
                  </FormLabel>
                  <FormLabel label="Sessions">
                    <input type="number" min="1" value={packDraft.sessions} onChange={(event) => setPackDraft((current) => ({ ...current, sessions: event.target.value }))} className={FIELD_CLASS} />
                  </FormLabel>
                  <button type="button" onClick={() => void addPack()} disabled={busy === 'pack'} className="mt-3 inline-flex w-full items-center justify-center gap-2 border border-black bg-black px-4 py-3 text-sm text-white hover:bg-white hover:text-black disabled:opacity-40">
                    <Plus size={16} />
                    Add pack
                  </button>
                </Panel>

                <Panel title="Availability" eyebrow="Weekly windows">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
	                    <select value={windowDraft.day_of_week} onChange={(event) => setWindowDraft((current) => ({ ...current, day_of_week: event.target.value }))} className={FIELD_CLASS}>
	                      {DAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
	                    </select>
	                    <input type="number" min="15" step="5" value={windowDraft.session_duration_minutes} onChange={(event) => setWindowDraft((current) => ({ ...current, session_duration_minutes: event.target.value, slot_duration_minutes: String(Number(event.target.value) + Number(current.buffer_minutes || 0)) }))} className={FIELD_CLASS} aria-label="Session minutes" />
	                    <input type="time" value={windowDraft.start_time} onChange={(event) => setWindowDraft((current) => ({ ...current, start_time: event.target.value }))} className={FIELD_CLASS} />
	                    <input type="time" value={windowDraft.end_time} onChange={(event) => setWindowDraft((current) => ({ ...current, end_time: event.target.value }))} className={FIELD_CLASS} />
	                    <input type="number" min="0" step="5" value={windowDraft.buffer_minutes} onChange={(event) => setWindowDraft((current) => ({ ...current, buffer_minutes: event.target.value, slot_duration_minutes: String(Number(current.session_duration_minutes || 0) + Number(event.target.value)) }))} className={FIELD_CLASS} aria-label="Buffer minutes" />
	                    <input type="number" min="15" step="5" value={windowDraft.slot_duration_minutes} onChange={(event) => setWindowDraft((current) => ({ ...current, slot_duration_minutes: event.target.value }))} className={FIELD_CLASS} aria-label="Slot cadence minutes" />
	                    <input value={windowDraft.location} onChange={(event) => setWindowDraft((current) => ({ ...current, location: event.target.value }))} placeholder="Location" className={`${FIELD_CLASS} col-span-2`} />
	                    <input value={windowDraft.label} onChange={(event) => setWindowDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Label" className={`${FIELD_CLASS} col-span-2`} />
                  </div>
                  <button type="button" onClick={() => void addAvailability()} disabled={busy === 'availability'} className="mt-3 w-full border border-black bg-black px-4 py-3 text-sm text-white hover:bg-white hover:text-black disabled:opacity-40">
                    Add availability
                  </button>
                  <div className="mt-4 space-y-2">
                    {availability.map((row) => (
                      <div key={row.id} className="flex flex-col gap-3 border border-black/8 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
	                        <div className="min-w-0">
	                          <p className="text-sm font-medium">{DAYS[row.day_of_week]} · {row.start_time.slice(0, 5)}-{row.end_time.slice(0, 5)}</p>
	                          <p className="text-xs text-black/35">{row.label || row.location || `${row.session_duration_minutes ?? 45}m session · ${row.buffer_minutes ?? 5}m buffer`}</p>
	                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => void toggleAvailability(row)} className="text-xs text-black/40 hover:text-black">
                            {row.is_active ? 'Disable' : 'Enable'}
                          </button>
                          <button type="button" onClick={() => void deleteAvailability(row.id)} className="text-black/25 hover:text-red-600" aria-label="Delete availability">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </Panel>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className={`border p-4 ${alert ? 'border-amber-300 bg-amber-50' : 'border-black/10 bg-white'}`}>
      <p className={`text-2xl font-light ${alert ? 'text-amber-700' : 'text-black'}`}>{value}</p>
      <p className={`mt-1 text-[0.6rem] uppercase tracking-[0.13em] ${alert ? 'text-amber-700' : 'text-black/35'}`}>{label}</p>
    </div>
  );
}

function Panel({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section className="border border-black/10 bg-white p-4">
      <p className="text-[0.6rem] uppercase tracking-[0.18em] text-black/35">{eyebrow}</p>
      <h2 className="mt-1 text-lg font-medium">{title}</h2>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function FormLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[0.62rem] uppercase tracking-[0.13em] text-black/35">{label}</span>
      {children}
    </label>
  );
}
