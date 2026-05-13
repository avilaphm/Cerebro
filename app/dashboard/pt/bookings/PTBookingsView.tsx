'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, Clock, Plus, RefreshCw, Trash2, X } from 'lucide-react';
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

function todayInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function addDaysInput(days: number) {
  const next = new Date();
  next.setDate(next.getDate() + days);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
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
    end_time: '12:00',
    slot_duration_minutes: '60',
    location: '',
    label: '',
  });
  const [bookingDraft, setBookingDraft] = useState({
    client_id: '',
    start_at: `${addDaysInput(7)}T07:00`,
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
  const lowCreditClients = clients.filter((client) => client.sessions_remaining <= 2).sort((a, b) => a.sessions_remaining - b.sessions_remaining);

  const addAvailability = async () => {
    setBusy('availability');
    const { error } = await supabase.from('pt_booking_availability').insert({
      day_of_week: Number(windowDraft.day_of_week),
      start_time: windowDraft.start_time,
      end_time: windowDraft.end_time,
      slot_duration_minutes: Number(windowDraft.slot_duration_minutes),
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

  return (
    <div className="min-h-screen bg-[#f7f7f3] p-6 md:p-8">
      <div className="max-w-7xl">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">PT Dashboard</p>
            <h1 className="mt-1 font-display text-3xl font-light tracking-[-0.02em]">Bookings</h1>
          </div>
          <button type="button" onClick={() => void loadData()} className="inline-flex items-center gap-2 border border-black/10 bg-white px-3 py-2 text-xs text-black/55 hover:border-black/30">
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        {status && (
          <div className="mb-5 flex items-center justify-between border border-black/10 bg-white px-4 py-3 text-sm text-black/60">
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
            <div className="mb-6 grid gap-3 md:grid-cols-4">
              <Metric label="Upcoming" value={String(nextAppointments.length)} />
              <Metric label="Pending cancels" value={String(requests.length)} alert={requests.length > 0} />
              <Metric label="Low credits" value={String(lowCreditClients.length)} alert={lowCreditClients.length > 0} />
              <Metric label="Availability" value={String(availability.filter((item) => item.is_active).length)} />
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
              <section className="space-y-6">
                <div className="border border-black/10 bg-white p-4">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <p className="text-[0.6rem] uppercase tracking-[0.18em] text-black/35">Calendar</p>
                      <h2 className="mt-1 text-lg font-medium">Upcoming sessions</h2>
                    </div>
                    <Clock size={17} className="text-black/30" />
                  </div>
                  <div className="space-y-2">
                    {nextAppointments.length === 0 ? (
                      <p className="border border-dashed border-black/10 py-8 text-center text-sm text-black/35">No sessions booked.</p>
                    ) : nextAppointments.map((appointment) => (
                      <div key={appointment.id} className="flex flex-col gap-3 border border-black/8 bg-[#fbfbf8] px-4 py-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-sm font-medium">{appointment.pt_clients?.name ?? 'Client'}</p>
                          <p className="mt-1 text-xs text-black/45">
                            {formatBookingDate(appointment.start_at)} · {formatBookingTime(appointment.start_at)}
                            {appointment.location ? ` · ${appointment.location}` : ''}
                          </p>
                          <p className="mt-1 text-[0.62rem] uppercase tracking-[0.12em] text-black/30">{appointment.status.replace(/_/g, ' ')}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void completeAppointment(appointment.id)}
                            disabled={busy === appointment.id}
                            className="inline-flex items-center gap-1.5 border border-black bg-black px-3 py-2 text-xs text-white hover:bg-white hover:text-black disabled:opacity-40"
                          >
                            <Check size={13} />
                            Complete
                          </button>
                          <button
                            type="button"
                            onClick={() => void cancelAppointment(appointment.id)}
                            disabled={busy === appointment.id}
                            className="inline-flex items-center gap-1.5 border border-black/10 bg-white px-3 py-2 text-xs text-black/55 hover:border-red-300 hover:text-red-700 disabled:opacity-40"
                          >
                            <Trash2 size={13} />
                            Cancel
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
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
                  <div className="grid grid-cols-2 gap-2">
                    <select value={windowDraft.day_of_week} onChange={(event) => setWindowDraft((current) => ({ ...current, day_of_week: event.target.value }))} className={FIELD_CLASS}>
                      {DAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
                    </select>
                    <input type="number" min="15" step="15" value={windowDraft.slot_duration_minutes} onChange={(event) => setWindowDraft((current) => ({ ...current, slot_duration_minutes: event.target.value }))} className={FIELD_CLASS} />
                    <input type="time" value={windowDraft.start_time} onChange={(event) => setWindowDraft((current) => ({ ...current, start_time: event.target.value }))} className={FIELD_CLASS} />
                    <input type="time" value={windowDraft.end_time} onChange={(event) => setWindowDraft((current) => ({ ...current, end_time: event.target.value }))} className={FIELD_CLASS} />
                    <input value={windowDraft.location} onChange={(event) => setWindowDraft((current) => ({ ...current, location: event.target.value }))} placeholder="Location" className={`${FIELD_CLASS} col-span-2`} />
                    <input value={windowDraft.label} onChange={(event) => setWindowDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Label" className={`${FIELD_CLASS} col-span-2`} />
                  </div>
                  <button type="button" onClick={() => void addAvailability()} disabled={busy === 'availability'} className="mt-3 w-full border border-black bg-black px-4 py-3 text-sm text-white hover:bg-white hover:text-black disabled:opacity-40">
                    Add availability
                  </button>
                  <div className="mt-4 space-y-2">
                    {availability.map((row) => (
                      <div key={row.id} className="flex items-center justify-between gap-3 border border-black/8 px-3 py-2">
                        <div>
                          <p className="text-sm font-medium">{DAYS[row.day_of_week]} · {row.start_time.slice(0, 5)}-{row.end_time.slice(0, 5)}</p>
                          <p className="text-xs text-black/35">{row.label || row.location || `${row.slot_duration_minutes}m slots`}</p>
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
