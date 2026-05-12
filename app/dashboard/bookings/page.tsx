'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Clock, Plus, Save, Trash2, XCircle } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import type {
  BookingAppointment,
  BookingAppointmentStatus,
  BookingAvailabilityWindow,
  BookingLeadOption,
  BookingLocationType,
  BookingSettings,
} from '@/utils/bookings/types';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const STATUS_LABELS: Record<BookingAppointmentStatus, string> = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

const STATUS_STYLES: Record<BookingAppointmentStatus, string> = {
  scheduled: 'border-black/10 bg-white text-black/70',
  confirmed: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  completed: 'border-black bg-black text-white',
  cancelled: 'border-red-200 bg-red-50 text-red-800',
  no_show: 'border-amber-200 bg-amber-50 text-amber-800',
};

const EMPTY_APPOINTMENT_FORM = {
  lead_id: '',
  start_at: '',
  duration_minutes: '30',
  invitee_name: '',
  invitee_email: '',
  invitee_phone: '',
  business_name: '',
  notes: '',
};

const EMPTY_WINDOW_FORM = {
  day_of_week: '2',
  start_time: '09:00',
  end_time: '12:00',
  label: '',
};

const FIELD_CLASS = 'w-full border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none transition-colors focus:border-black/45 disabled:opacity-40';

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfWeek(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatShortDate(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}

function timeLabel(value: string) {
  return value.slice(0, 5);
}

export default function BookingsPage() {
  const supabase = createClient();
  const [settings, setSettings] = useState<BookingSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState({
    public_slug: '',
    timezone: 'Australia/Sydney',
    call_duration_minutes: '30',
    buffer_minutes: '15',
    booking_horizon_days: '21',
    minimum_notice_hours: '12',
    location_type: 'video' as BookingLocationType,
    location_details: '',
    confirmation_message: '',
  });
  const [windows, setWindows] = useState<BookingAvailabilityWindow[]>([]);
  const [appointments, setAppointments] = useState<BookingAppointment[]>([]);
  const [leads, setLeads] = useState<BookingLeadOption[]>([]);
  const [windowForm, setWindowForm] = useState(EMPTY_WINDOW_FORM);
  const [appointmentForm, setAppointmentForm] = useState(EMPTY_APPOINTMENT_FORM);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingWindow, setSavingWindow] = useState(false);
  const [savingAppointment, setSavingAppointment] = useState(false);
  const [status, setStatus] = useState('');

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const rangeStart = useMemo(() => weekStart.toISOString(), [weekStart]);
  const rangeEnd = useMemo(() => addDays(weekStart, 7).toISOString(), [weekStart]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const [{ data: settingsRows, error: settingsError }, { data: leadRows, error: leadsError }] = await Promise.all([
      supabase.from('booking_settings').select('*').order('created_at', { ascending: true }).limit(1),
      supabase
        .from('leads')
        .select('id, name, email, industry')
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    if (settingsError) {
      setStatus(settingsError.message);
      setLoading(false);
      return;
    }
    if (leadsError) setStatus(leadsError.message);

    let currentSettings = (settingsRows?.[0] ?? null) as BookingSettings | null;
    if (!currentSettings) {
      const { data: inserted, error } = await supabase
        .from('booking_settings')
        .insert({
          owner_user_id: userData.user?.id ?? null,
          public_slug: 'cerebro-audit',
          timezone: 'Australia/Sydney',
          call_duration_minutes: 30,
          buffer_minutes: 15,
          booking_horizon_days: 21,
          minimum_notice_hours: 12,
          location_type: 'video',
        })
        .select('*')
        .single();
      if (error) {
        setStatus(error.message);
        setLoading(false);
        return;
      }
      currentSettings = inserted as BookingSettings;
    }

    setSettings(currentSettings);
    setSettingsDraft({
      public_slug: currentSettings.public_slug ?? '',
      timezone: currentSettings.timezone,
      call_duration_minutes: String(currentSettings.call_duration_minutes),
      buffer_minutes: String(currentSettings.buffer_minutes),
      booking_horizon_days: String(currentSettings.booking_horizon_days),
      minimum_notice_hours: String(currentSettings.minimum_notice_hours),
      location_type: currentSettings.location_type,
      location_details: currentSettings.location_details ?? '',
      confirmation_message: currentSettings.confirmation_message ?? '',
    });
    setAppointmentForm((prev) => ({ ...prev, duration_minutes: String(currentSettings.call_duration_minutes) }));
    setLeads((leadRows ?? []) as BookingLeadOption[]);
    setLoading(false);
  }, [supabase]);

  const loadBookingRows = useCallback(async () => {
    if (!settings) return;
    const [{ data: windowRows, error: windowsError }, { data: appointmentRows, error: appointmentError }] = await Promise.all([
      supabase
        .from('booking_availability_windows')
        .select('*')
        .eq('settings_id', settings.id)
        .order('day_of_week', { ascending: true })
        .order('start_time', { ascending: true }),
      supabase
        .from('booking_appointments')
        .select('*, leads(id, name, email, industry, website)')
        .gte('start_at', rangeStart)
        .lt('start_at', rangeEnd)
        .order('start_at', { ascending: true }),
    ]);
    if (windowsError) setStatus(windowsError.message);
    if (appointmentError) setStatus(appointmentError.message);
    setWindows((windowRows ?? []) as BookingAvailabilityWindow[]);
    setAppointments((appointmentRows ?? []) as BookingAppointment[]);
  }, [rangeEnd, rangeStart, settings, supabase]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    void loadBookingRows();
  }, [loadBookingRows]);

  const appointmentsByDay = useMemo(() => {
    const map = new Map<string, BookingAppointment[]>();
    appointments.forEach((appointment) => {
      const key = dateKey(new Date(appointment.start_at));
      const list = map.get(key) ?? [];
      list.push(appointment);
      map.set(key, list);
    });
    return map;
  }, [appointments]);

  const nextAppointment = appointments.find((appointment) => !['cancelled', 'completed', 'no_show'].includes(appointment.status));
  const activeAppointments = appointments.filter((appointment) => !['cancelled', 'no_show'].includes(appointment.status));
  const activeWindows = windows.filter((window) => window.is_active);

  const saveSettings = async () => {
    if (!settings) return;
    setSavingSettings(true);
    const { error } = await supabase
      .from('booking_settings')
      .update({
        public_slug: settingsDraft.public_slug.trim() || null,
        timezone: settingsDraft.timezone.trim() || 'Australia/Sydney',
        call_duration_minutes: Number(settingsDraft.call_duration_minutes),
        buffer_minutes: Number(settingsDraft.buffer_minutes),
        booking_horizon_days: Number(settingsDraft.booking_horizon_days),
        minimum_notice_hours: Number(settingsDraft.minimum_notice_hours),
        location_type: settingsDraft.location_type,
        location_details: settingsDraft.location_details.trim() || null,
        confirmation_message: settingsDraft.confirmation_message.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', settings.id);

    if (error) {
      setStatus(error.message);
    } else {
      setStatus('Booking settings saved.');
      await loadData();
    }
    setSavingSettings(false);
  };

  const addWindow = async () => {
    if (!settings) return;
    setSavingWindow(true);
    const { error } = await supabase.from('booking_availability_windows').insert({
      settings_id: settings.id,
      day_of_week: Number(windowForm.day_of_week),
      start_time: windowForm.start_time,
      end_time: windowForm.end_time,
      label: windowForm.label.trim() || null,
      is_active: true,
    });

    if (error) {
      setStatus(error.message);
    } else {
      setWindowForm(EMPTY_WINDOW_FORM);
      setStatus('Availability window added.');
      await loadBookingRows();
    }
    setSavingWindow(false);
  };

  const toggleWindow = async (window: BookingAvailabilityWindow) => {
    const { error } = await supabase
      .from('booking_availability_windows')
      .update({ is_active: !window.is_active, updated_at: new Date().toISOString() })
      .eq('id', window.id);
    if (error) {
      setStatus(error.message);
    } else {
      await loadBookingRows();
    }
  };

  const deleteWindow = async (windowId: string) => {
    const { error } = await supabase.from('booking_availability_windows').delete().eq('id', windowId);
    if (error) {
      setStatus(error.message);
    } else {
      await loadBookingRows();
    }
  };

  const selectLead = (leadId: string) => {
    const lead = leads.find((item) => item.id === leadId);
    setAppointmentForm((prev) => ({
      ...prev,
      lead_id: leadId,
      invitee_name: lead?.name ?? prev.invitee_name,
      invitee_email: lead?.email ?? prev.invitee_email,
      business_name: lead?.industry ?? prev.business_name,
    }));
  };

  const createAppointment = async () => {
    if (!settings || !appointmentForm.start_at || !appointmentForm.invitee_name.trim() || !appointmentForm.invitee_email.trim()) return;
    setSavingAppointment(true);
    const start = new Date(appointmentForm.start_at);
    const end = new Date(start.getTime() + Number(appointmentForm.duration_minutes) * 60000);
    const leadId = appointmentForm.lead_id || null;

    const { data, error } = await supabase
      .from('booking_appointments')
      .insert({
        settings_id: settings.id,
        lead_id: leadId,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        timezone: settings.timezone,
        status: 'scheduled',
        source: 'manual',
        invitee_name: appointmentForm.invitee_name.trim(),
        invitee_email: appointmentForm.invitee_email.trim(),
        invitee_phone: appointmentForm.invitee_phone.trim() || null,
        business_name: appointmentForm.business_name.trim() || null,
        notes: appointmentForm.notes.trim() || null,
      })
      .select('id')
      .single();

    if (error) {
      setStatus(error.message);
      setSavingAppointment(false);
      return;
    }

    if (leadId) {
      await supabase.from('lead_tags').upsert({
        lead_id: leadId,
        tag_slug: 'call_booked',
        source: 'manual',
        metadata: { booking_appointment_id: data.id },
      });
    }

    setAppointmentForm({ ...EMPTY_APPOINTMENT_FORM, duration_minutes: String(settings.call_duration_minutes) });
    setStatus('Appointment added.');
    await loadBookingRows();
    setSavingAppointment(false);
  };

  const updateAppointmentStatus = async (appointment: BookingAppointment, nextStatus: BookingAppointmentStatus) => {
    const now = new Date().toISOString();
    const patch: Partial<BookingAppointment> = { status: nextStatus, updated_at: now };
    if (nextStatus === 'confirmed') patch.confirmed_at = now;
    if (nextStatus === 'completed') patch.completed_at = now;
    if (nextStatus === 'cancelled') patch.cancelled_at = now;

    const { error } = await supabase.from('booking_appointments').update(patch).eq('id', appointment.id);
    if (error) {
      setStatus(error.message);
    } else {
      await loadBookingRows();
    }
  };

  const deleteAppointment = async (appointmentId: string) => {
    const { error } = await supabase.from('booking_appointments').delete().eq('id', appointmentId);
    if (error) {
      setStatus(error.message);
    } else {
      await loadBookingRows();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen p-6 md:p-10">
        <div className="flex items-center gap-2 text-sm text-black/40">
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/20 border-t-black/60" />
          Loading bookings...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f5f0] p-4 md:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-2 text-[0.65rem] font-medium uppercase tracking-[0.2em] text-black/40">Dashboard</p>
            <h1 className="font-display text-3xl font-light tracking-[-0.02em] text-black md:text-4xl">Bookings</h1>
          </div>
          <div className="flex items-center gap-2 text-xs text-black/45">
            <Clock size={15} />
            {settings?.timezone ?? 'Australia/Sydney'}
          </div>
        </div>

        {status && (
          <div className="mb-5 flex items-center justify-between gap-4 border border-black/10 bg-white px-4 py-3 text-sm text-black/60">
            <span>{status}</span>
            <button type="button" onClick={() => setStatus('')} className="text-black/35 hover:text-black">
              <XCircle size={16} />
            </button>
          </div>
        )}

        <section className="mb-6 grid gap-3 md:grid-cols-4">
          <Metric label="This week" value={String(activeAppointments.length)} detail="Active calls" />
          <Metric label="Next call" value={nextAppointment ? formatShortDate(nextAppointment.start_at) : '-'} detail={nextAppointment ? formatTime(nextAppointment.start_at) : 'Nothing booked'} />
          <Metric label="Availability" value={String(activeWindows.length)} detail="Active windows" />
          <Metric label="Default call" value={`${settings?.call_duration_minutes ?? 30}m`} detail={`${settings?.buffer_minutes ?? 0}m buffer`} />
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_25rem]">
          <section className="min-w-0">
            <div className="mb-4 flex flex-col gap-3 border border-black/10 bg-white px-4 py-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[0.65rem] font-medium uppercase tracking-[0.18em] text-black/35">Week view</p>
                <p className="mt-1 text-sm text-black/60">
                  {formatShortDate(weekDays[0])} - {formatShortDate(weekDays[6])}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))} className="border border-black/10 px-3 py-2 text-xs text-black/60 hover:border-black/30">
                  Previous
                </button>
                <button type="button" onClick={() => setWeekStart(startOfWeek(new Date()))} className="border border-black/10 px-3 py-2 text-xs text-black/60 hover:border-black/30">
                  Today
                </button>
                <button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))} className="border border-black bg-black px-3 py-2 text-xs text-white hover:bg-white hover:text-black">
                  Next
                </button>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-7">
              {weekDays.map((day) => {
                const dayAppointments = appointmentsByDay.get(dateKey(day)) ?? [];
                return (
                  <div key={dateKey(day)} className="min-h-44 border border-black/10 bg-white p-3">
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <p className="text-[0.65rem] font-medium uppercase tracking-[0.16em] text-black/35">{DAYS[day.getDay()].slice(0, 3)}</p>
                        <p className="text-sm font-medium text-black">{formatShortDate(day)}</p>
                      </div>
                      <span className="text-xs text-black/30">{dayAppointments.length}</span>
                    </div>
                    <div className="space-y-2">
                      {dayAppointments.length === 0 ? (
                        <p className="pt-4 text-xs text-black/25">No calls</p>
                      ) : (
                        dayAppointments.map((appointment) => (
                          <AppointmentTile
                            key={appointment.id}
                            appointment={appointment}
                            onStatus={(nextStatus) => void updateAppointmentStatus(appointment, nextStatus)}
                            onDelete={() => void deleteAppointment(appointment.id)}
                          />
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <aside className="space-y-6">
            <section className="border border-black/10 bg-white p-4">
              <div className="mb-4 flex items-center gap-2">
                <Plus size={16} />
                <h2 className="text-sm font-medium text-black">Add appointment</h2>
              </div>
              <div className="space-y-3">
                <FormField label="Link lead">
                  <select value={appointmentForm.lead_id} onChange={(event) => selectLead(event.target.value)} className={FIELD_CLASS}>
                    <option value="">No linked lead</option>
                    {leads.map((lead) => (
                      <option key={lead.id} value={lead.id}>
                        {lead.name || lead.email || 'Unnamed lead'}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Start">
                  <input
                    type="datetime-local"
                    value={appointmentForm.start_at}
                    onChange={(event) => setAppointmentForm((prev) => ({ ...prev, start_at: event.target.value }))}
                    className={FIELD_CLASS}
                  />
                </FormField>
                <FormField label="Duration minutes">
                  <input
                    type="number"
                    min="15"
                    step="15"
                    value={appointmentForm.duration_minutes}
                    onChange={(event) => setAppointmentForm((prev) => ({ ...prev, duration_minutes: event.target.value }))}
                    className={FIELD_CLASS}
                  />
                </FormField>
                <FormField label="Name">
                  <input value={appointmentForm.invitee_name} onChange={(event) => setAppointmentForm((prev) => ({ ...prev, invitee_name: event.target.value }))} className={FIELD_CLASS} />
                </FormField>
                <FormField label="Email">
                  <input type="email" value={appointmentForm.invitee_email} onChange={(event) => setAppointmentForm((prev) => ({ ...prev, invitee_email: event.target.value }))} className={FIELD_CLASS} />
                </FormField>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Phone">
                    <input value={appointmentForm.invitee_phone} onChange={(event) => setAppointmentForm((prev) => ({ ...prev, invitee_phone: event.target.value }))} className={FIELD_CLASS} />
                  </FormField>
                  <FormField label="Business">
                    <input value={appointmentForm.business_name} onChange={(event) => setAppointmentForm((prev) => ({ ...prev, business_name: event.target.value }))} className={FIELD_CLASS} />
                  </FormField>
                </div>
                <FormField label="Notes">
                  <textarea value={appointmentForm.notes} onChange={(event) => setAppointmentForm((prev) => ({ ...prev, notes: event.target.value }))} className={`${FIELD_CLASS} min-h-20 resize-none`} />
                </FormField>
                <button
                  type="button"
                  onClick={() => void createAppointment()}
                  disabled={savingAppointment || !appointmentForm.start_at || !appointmentForm.invitee_name.trim() || !appointmentForm.invitee_email.trim()}
                  className="flex w-full items-center justify-center gap-2 border border-black bg-black px-4 py-3 text-sm text-white transition-colors hover:bg-white hover:text-black disabled:opacity-30"
                >
                  <CalendarDays size={16} />
                  {savingAppointment ? 'Adding...' : 'Add appointment'}
                </button>
              </div>
            </section>
          </aside>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section className="border border-black/10 bg-white p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[0.65rem] font-medium uppercase tracking-[0.18em] text-black/35">Availability</p>
                <h2 className="mt-1 text-lg font-medium text-black">Weekly windows</h2>
              </div>
              <span className="text-xs text-black/35">{windows.length} saved</span>
            </div>

            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <select value={windowForm.day_of_week} onChange={(event) => setWindowForm((prev) => ({ ...prev, day_of_week: event.target.value }))} className={FIELD_CLASS}>
                {DAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
              </select>
              <input type="time" value={windowForm.start_time} onChange={(event) => setWindowForm((prev) => ({ ...prev, start_time: event.target.value }))} className={FIELD_CLASS} />
              <input type="time" value={windowForm.end_time} onChange={(event) => setWindowForm((prev) => ({ ...prev, end_time: event.target.value }))} className={FIELD_CLASS} />
              <input value={windowForm.label} onChange={(event) => setWindowForm((prev) => ({ ...prev, label: event.target.value }))} placeholder="Label" className={FIELD_CLASS} />
              <button type="button" onClick={() => void addWindow()} disabled={savingWindow} className="border border-black bg-black px-4 py-2 text-sm text-white hover:bg-white hover:text-black disabled:opacity-30 sm:col-span-2">
                Add
              </button>
            </div>

            <div className="space-y-2">
              {windows.length === 0 ? (
                <p className="border border-dashed border-black/10 py-8 text-center text-sm text-black/30">No availability windows yet.</p>
              ) : (
                windows.map((window) => (
                  <div key={window.id} className="flex items-center justify-between gap-3 border border-black/10 px-3 py-3">
                    <div>
                      <p className="text-sm font-medium text-black">{DAYS[window.day_of_week]} · {timeLabel(window.start_time)}-{timeLabel(window.end_time)}</p>
                      <p className="text-xs text-black/40">{window.label || (window.is_active ? 'Active' : 'Inactive')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => void toggleWindow(window)} className="border border-black/10 px-3 py-1.5 text-xs text-black/55 hover:border-black/30">
                        {window.is_active ? 'Disable' : 'Enable'}
                      </button>
                      <button type="button" onClick={() => void deleteWindow(window.id)} className="text-black/30 hover:text-red-600" aria-label="Delete availability window">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="border border-black/10 bg-white p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[0.65rem] font-medium uppercase tracking-[0.18em] text-black/35">Settings</p>
                <h2 className="mt-1 text-lg font-medium text-black">Booking defaults</h2>
              </div>
              <button type="button" onClick={() => void saveSettings()} disabled={savingSettings} className="flex items-center gap-2 border border-black bg-black px-4 py-2 text-sm text-white hover:bg-white hover:text-black disabled:opacity-30">
                <Save size={15} />
                {savingSettings ? 'Saving...' : 'Save'}
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <FormField label="Public slug">
                <input value={settingsDraft.public_slug} onChange={(event) => setSettingsDraft((prev) => ({ ...prev, public_slug: event.target.value }))} className={FIELD_CLASS} />
              </FormField>
              <FormField label="Timezone">
                <input value={settingsDraft.timezone} onChange={(event) => setSettingsDraft((prev) => ({ ...prev, timezone: event.target.value }))} className={FIELD_CLASS} />
              </FormField>
              <FormField label="Call duration">
                <input type="number" min="15" value={settingsDraft.call_duration_minutes} onChange={(event) => setSettingsDraft((prev) => ({ ...prev, call_duration_minutes: event.target.value }))} className={FIELD_CLASS} />
              </FormField>
              <FormField label="Buffer minutes">
                <input type="number" min="0" value={settingsDraft.buffer_minutes} onChange={(event) => setSettingsDraft((prev) => ({ ...prev, buffer_minutes: event.target.value }))} className={FIELD_CLASS} />
              </FormField>
              <FormField label="Horizon days">
                <input type="number" min="1" value={settingsDraft.booking_horizon_days} onChange={(event) => setSettingsDraft((prev) => ({ ...prev, booking_horizon_days: event.target.value }))} className={FIELD_CLASS} />
              </FormField>
              <FormField label="Minimum notice hours">
                <input type="number" min="0" value={settingsDraft.minimum_notice_hours} onChange={(event) => setSettingsDraft((prev) => ({ ...prev, minimum_notice_hours: event.target.value }))} className={FIELD_CLASS} />
              </FormField>
              <FormField label="Location type">
                <select value={settingsDraft.location_type} onChange={(event) => setSettingsDraft((prev) => ({ ...prev, location_type: event.target.value as BookingLocationType }))} className={FIELD_CLASS}>
                  <option value="video">Video</option>
                  <option value="phone">Phone</option>
                  <option value="in_person">In person</option>
                </select>
              </FormField>
              <FormField label="Location details">
                <input value={settingsDraft.location_details} onChange={(event) => setSettingsDraft((prev) => ({ ...prev, location_details: event.target.value }))} className={FIELD_CLASS} />
              </FormField>
            </div>
            <FormField label="Confirmation message">
              <textarea value={settingsDraft.confirmation_message} onChange={(event) => setSettingsDraft((prev) => ({ ...prev, confirmation_message: event.target.value }))} className={`${FIELD_CLASS} mt-3 min-h-24 resize-none`} />
            </FormField>
          </section>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="border border-black/10 bg-white p-4">
      <p className="text-[0.65rem] font-medium uppercase tracking-[0.16em] text-black/35">{label}</p>
      <p className="mt-2 text-2xl font-light text-black">{value}</p>
      <p className="mt-1 text-xs text-black/40">{detail}</p>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[0.65rem] font-medium uppercase tracking-[0.14em] text-black/35">{label}</span>
      {children}
    </label>
  );
}

function AppointmentTile({
  appointment,
  onStatus,
  onDelete,
}: {
  appointment: BookingAppointment;
  onStatus: (status: BookingAppointmentStatus) => void;
  onDelete: () => void;
}) {
  return (
    <div className={`border p-3 ${STATUS_STYLES[appointment.status]}`}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium">{formatTime(appointment.start_at)}</p>
          <p className="truncate text-sm font-medium">{appointment.invitee_name}</p>
        </div>
        <button type="button" onClick={onDelete} className="shrink-0 opacity-40 hover:opacity-100" aria-label="Delete appointment">
          <Trash2 size={14} />
        </button>
      </div>
      <p className="truncate text-xs opacity-70">{appointment.business_name || appointment.invitee_email}</p>
      {appointment.leads && <p className="mt-1 truncate text-[0.65rem] opacity-55">Lead: {appointment.leads.name || appointment.leads.email}</p>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'] as BookingAppointmentStatus[]).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => onStatus(status)}
            disabled={appointment.status === status}
            className="border border-current px-2 py-1 text-[0.6rem] uppercase tracking-[0.1em] opacity-55 hover:opacity-100 disabled:opacity-100"
          >
            {status === 'confirmed' && <CheckCircle2 size={11} className="mr-1 inline" />}
            {STATUS_LABELS[status]}
          </button>
        ))}
      </div>
    </div>
  );
}
