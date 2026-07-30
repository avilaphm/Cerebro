'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import type { PTClient, PTGroup } from '@/utils/pt/types';

const STATUS_LABELS: Record<PTClient['status'], string> = {
  invited: 'Invited',
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
};

const STATUS_COLORS: Record<PTClient['status'], string> = {
  invited: 'bg-amber-50 text-amber-700 border-amber-200',
  active: 'bg-green-50 text-green-700 border-green-200',
  paused: 'bg-black/5 text-black/50 border-black/10',
  archived: 'bg-black/5 text-black/30 border-black/8',
};

export default function PTClientsView({ initialClients, notesByClient = {}, groupsByClient = {} }: { initialClients: PTClient[]; notesByClient?: Record<string, number>; groupsByClient?: Record<string, PTGroup[]> }) {
  const supabase = createClient();
  const router = useRouter();
  const viewRef = useRef<HTMLDivElement>(null);
  const [clients, setClients] = useState(initialClients);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    goals: '',
    notes: '',
    sendParq: true,
    alreadyBooked: false,
    appointmentStartAt: '',
    sendPortalSetup: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!showAdd) return;

    const scrollContainers = new Set<HTMLElement>([
      document.documentElement,
      document.body,
    ]);
    let ancestor = viewRef.current?.parentElement ?? null;
    while (ancestor) {
      const overflowY = window.getComputedStyle(ancestor).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') {
        scrollContainers.add(ancestor);
      }
      ancestor = ancestor.parentElement;
    }

    const previousOverflow = [...scrollContainers].map((element) => ({
      element,
      overflow: element.style.overflow,
    }));
    previousOverflow.forEach(({ element }) => {
      element.style.overflow = 'hidden';
    });

    return () => {
      previousOverflow.forEach(({ element, overflow }) => {
        element.style.overflow = overflow;
      });
    };
  }, [showAdd]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const appointmentStartAt = form.alreadyBooked && form.appointmentStartAt
        ? new Date(form.appointmentStartAt).toISOString()
        : null;
      const response = await fetch('/api/pt/clients/create-with-intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          goals: form.goals,
          notes: form.notes,
          send_parq: form.sendParq,
          already_booked: form.alreadyBooked,
          appointment_start_at: appointmentStartAt,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error ?? 'Could not create client.');

      const created = json.client as PTClient;
      setClients((prev) => [created, ...prev.filter((client) => client.id !== created.id)]);

      if (form.sendPortalSetup) {
        const { error: inviteErr } = await supabase.functions.invoke('invite-pt-client', {
          body: { client_id: created.id },
        });
        if (inviteErr) {
          json.warning = [json.warning, `The portal setup email failed: ${inviteErr.message}`].filter(Boolean).join(' ');
        }
      }

      const resultParts = [
        `${created.name} was added.`,
        form.sendParq && json.parq_sent ? 'PAR-Q sent.' : null,
        form.alreadyBooked && json.calendar_synced ? 'Assessment added to Google Calendar.' : null,
        json.warning,
      ].filter(Boolean);
      setNotice(resultParts.join(' '));
      setForm({
        name: '',
        email: '',
        goals: '',
        notes: '',
        sendParq: true,
        alreadyBooked: false,
        appointmentStartAt: '',
        sendPortalSetup: false,
      });
      setShowAdd(false);
      router.refresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create client.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={viewRef} className="px-5 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <div className="mb-8 flex flex-col gap-4 sm:mb-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-1">PT</p>
          <h1 className="font-display text-3xl font-light tracking-[-0.02em]">Clients</h1>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="w-full border border-black bg-black px-5 py-3 text-sm text-white transition-colors hover:bg-white hover:text-black sm:w-auto sm:py-2.5"
        >
          + Add client
        </button>
      </div>

      {notice && (
        <div className="mb-5 flex items-start justify-between gap-4 border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <p>{notice}</p>
          <button type="button" onClick={() => setNotice('')} className="shrink-0 text-xs underline underline-offset-2">Dismiss</button>
        </div>
      )}

      {clients.length === 0 ? (
        <p className="text-sm text-black/40">No clients yet. Add your first client above.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map((client) => (
            <Link
              key={client.id}
              href={`/dashboard/pt/clients/${client.id}`}
              className="group border border-black/10 bg-white p-5 hover:border-black/30 hover:shadow-sm transition-all block"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-full bg-black/8 flex items-center justify-center text-sm font-medium text-black/60 shrink-0">
                  {client.name.charAt(0).toUpperCase()}
                </div>
                <span className={`text-[0.6rem] uppercase tracking-[0.15em] px-2 py-0.5 border rounded-full ${STATUS_COLORS[client.status]}`}>
                  {STATUS_LABELS[client.status]}
                </span>
              </div>
              <p className="font-medium text-sm">{client.name}</p>
              <p className="text-xs text-black/40 mt-0.5 truncate">{client.email}</p>
              {client.goals && (
                <p className="text-xs text-black/50 mt-2 line-clamp-2">{client.goals}</p>
              )}
              {(groupsByClient[client.id] ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {(groupsByClient[client.id] ?? []).map((g) => (
                    <span key={g.id} className="text-[0.6rem] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded-full text-white leading-none" style={{ backgroundColor: g.color }}>
                      {g.name}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-3 pt-3 border-t border-black/8 flex items-center justify-between">
                <span className="text-xs text-black/30">
                  {client.sessions_remaining} sessions left
                </span>
                <div className="flex items-center gap-2">
                  {(notesByClient[client.id] ?? 0) > 0 && (
                    <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">
                      {notesByClient[client.id]} note{notesByClient[client.id] !== 1 ? 's' : ''}
                    </span>
                  )}
                  <span className={`text-xs ${client.password_created_at ? 'text-green-600' : 'text-black/30'}`}>
                    {client.password_created_at ? '✓ Active' : 'Awaiting'}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden overscroll-none bg-black/60 p-3 sm:p-6" role="presentation">
          <div
            className="client-intake-modal no-glass max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto overscroll-contain border border-black/15 bg-white shadow-[0_32px_100px_rgba(0,0,0,0.38)] sm:max-h-[calc(100dvh-3rem)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-client-title"
          >
            <div className="border-b border-black/10 bg-white px-5 py-5 sm:px-7 sm:py-6">
              <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">New intake</p>
              <h2 id="add-client-title" className="mt-1 font-display text-3xl font-light tracking-[-0.02em]">Add client</h2>
              <p className="mt-2 max-w-lg text-sm leading-6 text-black/50">Create their profile, send the PAR-Q, and connect an existing movement assessment to your calendar.</p>
            </div>
            <form onSubmit={handleCreate} className="space-y-6 bg-white px-5 py-5 sm:px-7 sm:py-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs uppercase tracking-[0.15em] text-black/45">Name</span>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    required
                    autoFocus
                    className="h-12 w-full border border-black/15 bg-white px-3 text-sm text-black outline-none transition-colors focus:border-black"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs uppercase tracking-[0.15em] text-black/45">Email</span>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    required
                    className="h-12 w-full border border-black/15 bg-white px-3 text-sm text-black outline-none transition-colors focus:border-black"
                  />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs uppercase tracking-[0.15em] text-black/45">Goals</span>
                  <input
                    type="text"
                    value={form.goals}
                    onChange={(e) => setForm((f) => ({ ...f, goals: e.target.value }))}
                    className="h-12 w-full border border-black/15 bg-white px-3 text-sm text-black outline-none transition-colors focus:border-black"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs uppercase tracking-[0.15em] text-black/45">Notes</span>
                  <input
                    type="text"
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    className="h-12 w-full border border-black/15 bg-white px-3 text-sm text-black outline-none transition-colors focus:border-black"
                  />
                </label>
              </div>

              <div className="border border-black/10 bg-[#f7f6f1] px-4 pb-4 pt-5 sm:px-5 sm:pb-5 sm:pt-6">
                <p className="mb-5 text-xs uppercase tracking-[0.16em] text-black/45">Before the assessment</p>
                <div className="space-y-4">
                  <ToggleRow
                    checked={form.sendParq}
                    onChange={(checked) => setForm((f) => ({ ...f, sendParq: checked }))}
                    title="Send PAR-Q now"
                    copy="Emails a private form link to the client."
                  />
                  <div className="border-t border-black/10 pt-4">
                    <ToggleRow
                      checked={form.alreadyBooked}
                      onChange={(checked) => setForm((f) => ({ ...f, alreadyBooked: checked, appointmentStartAt: checked ? f.appointmentStartAt : '' }))}
                      title="Already booked with me"
                      copy="Add the movement assessment to Cerebro and Google Calendar."
                    />
                  </div>
                  {form.alreadyBooked && (
                    <label className="block border-l-2 border-black pl-4">
                      <span className="mb-1.5 block text-xs uppercase tracking-[0.15em] text-black/45">Assessment date and time</span>
                      <input
                        type="datetime-local"
                        value={form.appointmentStartAt}
                        onChange={(e) => setForm((f) => ({ ...f, appointmentStartAt: e.target.value }))}
                        required
                        min={minimumLocalDateTime()}
                        className="h-12 w-full border border-black/15 bg-white px-3 text-sm text-black outline-none transition-colors focus:border-black sm:max-w-sm"
                      />
                      <span className="mt-2 block text-xs text-black/45">50 minute movement assessment. A 5 minute calendar buffer is added automatically.</span>
                    </label>
                  )}
                  <div className="border-t border-black/10 pt-4">
                    <ToggleRow
                      checked={form.sendPortalSetup}
                      onChange={(checked) => setForm((f) => ({ ...f, sendPortalSetup: checked }))}
                      title="Send client portal setup"
                      copy="Optional. Sends a separate email to activate their client portal."
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 border-y border-black/10 py-3 text-center text-[0.6rem] uppercase tracking-[0.12em] text-black/40">
                <span>Client</span>
                <span>PAR-Q</span>
                <span>Calendar</span>
                <span>M&amp;L</span>
              </div>

              {error && <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setShowAdd(false);
                    setError('');
                  }}
                  className="min-h-12 border border-black/20 px-6 text-sm transition-colors hover:bg-black/5 sm:min-w-36"
                >
                  Cancel
                </button>
                <input
                  type="submit"
                  disabled={saving}
                  value={saving ? 'Creating client...' : 'Create client'}
                  className="min-h-12 cursor-pointer border border-black bg-black px-7 text-sm text-white transition-colors hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-40 sm:min-w-44"
                />
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function ToggleRow({
  checked,
  onChange,
  title,
  copy,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  copy: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-5">
      <span>
        <span className="block text-sm font-medium text-black">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-black/50">{copy}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-5 w-5 shrink-0 accent-black"
      />
    </label>
  );
}

function minimumLocalDateTime() {
  const date = new Date(Date.now() + 5 * 60_000);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
