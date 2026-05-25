'use client';

import { useState } from 'react';
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
  const [clients, setClients] = useState(initialClients);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', goals: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const { data, error: err } = await supabase
      .from('pt_clients')
      .insert({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        goals: form.goals.trim() || null,
        notes: form.notes.trim() || null,
        status: 'invited',
        use_brain: true,
      })
      .select()
      .single();
    if (err) {
      setError(err.message);
      setSaving(false);
      return;
    }

    const created = data as PTClient;
    setClients((prev) => [created, ...prev]);

    // Send the welcome / setup email immediately on creation, via the same edge
    // function the "Resend link" button uses. Without this, new clients only
    // got an email when the link was manually resent.
    const { error: inviteErr } = await supabase.functions.invoke('invite-pt-client', {
      body: { client_id: created.id },
    });
    if (inviteErr) {
      // Client exists; only the email failed. Keep the modal open so the coach
      // sees it and can resend from the client's profile.
      setError(`${created.name} was created, but the welcome email failed to send (${inviteErr.message}). Open their profile and use "Resend link".`);
      router.refresh();
      setSaving(false);
      return;
    }

    setForm({ name: '', email: '', goals: '', notes: '' });
    setShowAdd(false);
    router.refresh();
    setSaving(false);
  };

  return (
    <div className="px-5 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
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
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="liquid-solid max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto border border-black/10 bg-white">
            <div className="px-6 py-5 border-b border-black/8">
              <h2 className="font-display text-lg font-light">Add client</h2>
            </div>
            <form onSubmit={handleCreate} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-[0.15em] text-black/40 mb-1.5">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  className="w-full border border-black/10 px-3 py-2.5 text-sm outline-none focus:border-black/40"
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-[0.15em] text-black/40 mb-1.5">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  required
                  className="w-full border border-black/10 px-3 py-2.5 text-sm outline-none focus:border-black/40"
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-[0.15em] text-black/40 mb-1.5">Goals</label>
                <input
                  type="text"
                  value={form.goals}
                  onChange={(e) => setForm((f) => ({ ...f, goals: e.target.value }))}
                  className="w-full border border-black/10 px-3 py-2.5 text-sm outline-none focus:border-black/40"
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-[0.15em] text-black/40 mb-1.5">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  className="w-full border border-black/10 px-3 py-2.5 text-sm outline-none focus:border-black/40 resize-none"
                />
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex flex-col gap-3 pt-1 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="flex-1 border border-black/20 py-2.5 text-sm hover:bg-black/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 border border-black bg-black text-white py-2.5 text-sm disabled:opacity-40"
                >
                  {saving ? 'Creating…' : 'Create client'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
