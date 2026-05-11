'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import type { PTClient, PTProgramTemplate, PTProgramAssignment } from '@/utils/pt/types';

const STATUS_OPTIONS: PTClient['status'][] = ['invited', 'active', 'paused', 'archived'];
const STATUS_COLORS: Record<PTClient['status'], string> = {
  invited: 'bg-amber-50 text-amber-700 border-amber-200',
  active: 'bg-green-50 text-green-700 border-green-200',
  paused: 'bg-black/5 text-black/50 border-black/10',
  archived: 'bg-black/5 text-black/30 border-black/8',
};

interface PTEvent {
  id: string;
  event_type: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

interface PTNote {
  id: string;
  content: string;
  is_active: boolean;
  created_at: string;
  source_message_id: string | null;
}

interface Props {
  client: PTClient;
  templates: PTProgramTemplate[];
  assignments: PTProgramAssignment[];
  events: PTEvent[];
  notes: PTNote[];
}

export default function PTClientDetail({ client: initial, templates, assignments, events, notes: initialNotes }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [client, setClient] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: initial.name,
    goals: initial.goals ?? '',
    notes: initial.notes ?? '',
    sessions_remaining: initial.sessions_remaining,
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [notes, setNotes] = useState(initialNotes);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [status, setStatus] = useState('');

  const save = async () => {
    setSaving(true);
    const { data, error } = await supabase
      .from('pt_clients')
      .update({
        name: form.name.trim(),
        goals: form.goals.trim() || null,
        notes: form.notes.trim() || null,
        sessions_remaining: form.sessions_remaining,
      })
      .eq('id', client.id)
      .select()
      .single();
    if (!error && data) setClient(data as PTClient);
    setEditing(false);
    setSaving(false);
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setStatus('Uploading…');
    const path = `${client.id}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage
      .from('pt-client-docs')
      .upload(path, file, { upsert: true });
    if (upErr) {
      setStatus(`Upload failed: ${upErr.message}`);
      setUploading(false);
      return;
    }
    const { data: updated } = await supabase
      .from('pt_clients')
      .update({ document_url: path })
      .eq('id', client.id)
      .select()
      .single();
    if (updated) setClient(updated as PTClient);
    setStatus('Document saved.');
    setUploading(false);
  };

  const viewDocument = async () => {
    if (!client.document_url) return;
    const { data } = await supabase.storage
      .from('pt-client-docs')
      .createSignedUrl(client.document_url, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  };

  const assignProgramme = async (templateId: string) => {
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    setAssigningId(templateId);
    await supabase.from('pt_program_assignments').insert({
      client_id: client.id,
      template_id: templateId,
      name: template.name,
      goal: template.goal,
      duration_weeks: template.duration_weeks,
      phase_count: template.phase_count,
      status: 'active',
      programme: template.programme,
    });
    await supabase.from('pt_events').insert({
      client_id: client.id,
      event_type: 'programme_assigned',
      metadata: { template_id: templateId, template_name: template.name },
    });
    setAssigningId(null);
    router.refresh();
  };

  const sendInvite = async () => {
    setInviting(true);
    setStatus('Sending invite…');
    const { error } = await supabase.functions.invoke('invite-pt-client', {
      body: { client_id: client.id },
    });
    setStatus(error ? `Error: ${error.message}` : 'Invite sent.');
    setInviting(false);
  };

  const deleteClient = async () => {
    const { error } = await supabase.functions.invoke('delete-pt-client', {
      body: { client_id: client.id },
    });
    if (!error) {
      router.push('/dashboard/pt/clients');
    } else {
      setStatus(`Error: ${error.message}`);
      setConfirmDelete(false);
    }
  };

  const activeAssignment = assignments.find((a) => a.status === 'active');
  const lastLogin = events.find((e) => e.event_type === 'client_login');

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-8">
        <Link href="/dashboard/pt/clients" className="text-black/30 hover:text-black text-sm transition-colors">
          ← Clients
        </Link>
      </div>

      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-black/8 flex items-center justify-center text-xl font-medium text-black/50">
            {client.name.charAt(0).toUpperCase()}
          </div>
          <div>
            {editing ? (
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="font-display text-2xl font-light border-b border-black/20 outline-none bg-transparent"
              />
            ) : (
              <h1 className="font-display text-2xl font-light">{client.name}</h1>
            )}
            <p className="text-sm text-black/40 mt-0.5">{client.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={client.status}
            onChange={async (e) => {
              const newStatus = e.target.value as PTClient['status'];
              await supabase.from('pt_clients').update({ status: newStatus }).eq('id', client.id);
              setClient((c) => ({ ...c, status: newStatus }));
            }}
            className={`text-xs border px-2 py-1 rounded-full cursor-pointer outline-none ${STATUS_COLORS[client.status]}`}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
          {!editing && (
            <button onClick={() => setEditing(true)} className="text-xs border border-black/20 px-3 py-1 hover:bg-black hover:text-white transition-colors">
              Edit
            </button>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3 mb-8">
        <div className="border border-black/8 px-4 py-4">
          <p className="text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1">Account</p>
          <p className="text-sm font-medium">
            {client.password_created_at ? (
              <span className="text-green-600">Active</span>
            ) : (
              <span className="text-amber-600">Awaiting setup</span>
            )}
          </p>
          {client.password_created_at && (
            <p className="text-xs text-black/30 mt-0.5">
              Since {new Date(client.password_created_at).toLocaleDateString('en-AU')}
            </p>
          )}
        </div>
        <div className="border border-black/8 px-4 py-4">
          <p className="text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1">Last login</p>
          <p className="text-sm font-medium">
            {lastLogin
              ? new Date(lastLogin.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
              : 'Never'}
          </p>
        </div>
        <div className="border border-black/8 px-4 py-4">
          <p className="text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1">Sessions left</p>
          {editing ? (
            <input
              type="number"
              min={0}
              value={form.sessions_remaining}
              onChange={(e) => setForm((f) => ({ ...f, sessions_remaining: parseInt(e.target.value) || 0 }))}
              className="w-20 border-b border-black/20 text-sm font-medium outline-none bg-transparent"
            />
          ) : (
            <p className={`text-sm font-medium ${client.sessions_remaining <= 3 ? 'text-amber-600' : ''}`}>
              {client.sessions_remaining}
            </p>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-5 mb-8">
        <div>
          <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-2">Goals</label>
          {editing ? (
            <input
              value={form.goals}
              onChange={(e) => setForm((f) => ({ ...f, goals: e.target.value }))}
              className="w-full border border-black/10 px-3 py-2.5 text-sm outline-none focus:border-black/40"
            />
          ) : (
            <p className="text-sm text-black/60">{client.goals || '—'}</p>
          )}
        </div>
        <div>
          <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-2">Notes</label>
          {editing ? (
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={3}
              className="w-full border border-black/10 px-3 py-2.5 text-sm outline-none focus:border-black/40 resize-none"
            />
          ) : (
            <p className="text-sm text-black/60">{client.notes || '—'}</p>
          )}
        </div>
      </div>

      {editing && (
        <div className="flex gap-3 mb-8">
          <button onClick={() => setEditing(false)} className="border border-black/20 px-5 py-2 text-sm hover:bg-black/5 transition-colors">
            Cancel
          </button>
          <button onClick={save} disabled={saving} className="border border-black bg-black text-white px-5 py-2 text-sm disabled:opacity-40">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}

      <div className="border-t border-black/8 pt-6 mb-8">
        <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-4">Programme</h2>
        {activeAssignment ? (
          <div className="border border-black/10 px-5 py-4">
            <p className="text-sm font-medium">{activeAssignment.name}</p>
            <p className="text-xs text-black/40 mt-0.5">
              {activeAssignment.phase_count} phase{activeAssignment.phase_count !== 1 ? 's' : ''} · {activeAssignment.duration_weeks} weeks
            </p>
            <span className="inline-block mt-2 text-xs border border-green-300 bg-green-50 text-green-700 px-2 py-0.5 rounded-full">
              Active
            </span>
          </div>
        ) : (
          <div className="border border-black/8 px-5 py-4">
            <p className="text-sm text-black/40 mb-3">No active programme.</p>
            {templates.length > 0 ? (
              <div className="space-y-2">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => assignProgramme(t.id)}
                    disabled={assigningId === t.id}
                    className="w-full text-left border border-black/10 px-4 py-3 hover:border-black/30 hover:bg-black/2 transition-colors disabled:opacity-40"
                  >
                    <p className="text-sm font-medium">{t.name}</p>
                    <p className="text-xs text-black/40">{t.phase_count} phases · {t.duration_weeks} weeks</p>
                  </button>
                ))}
              </div>
            ) : (
              <Link href="/dashboard/pt/programmes" className="text-xs text-black/40 hover:text-black underline">
                Create a programme first
              </Link>
            )}
          </div>
        )}
      </div>

      {notes.length > 0 && (
        <div className="border-t border-black/8 pt-6 mb-8">
          <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-amber-600 mb-4">
            Notes ({notes.length})
          </h2>
          <div className="space-y-2">
            {notes.map((note) => (
              <div key={note.id} className="flex items-start justify-between gap-4 border border-amber-200 bg-amber-50 px-4 py-3">
                <div>
                  <p className="text-sm text-black/80">{note.content}</p>
                  <p className="text-xs text-black/30 mt-1">
                    {new Date(note.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    await supabase.from('pt_client_notes').update({ is_active: false }).eq('id', note.id);
                    setNotes((prev) => prev.filter((n) => n.id !== note.id));
                  }}
                  className="text-xs text-black/30 hover:text-black transition-colors shrink-0"
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-black/8 pt-6 mb-8">
        <h2 className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-4">Client profile document</h2>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.doc,.docx,.txt,.md"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleUpload(file);
          }}
        />
        {client.document_url ? (
          <div className="flex items-center gap-3">
            <button
              onClick={() => void viewDocument()}
              className="text-sm border border-black/10 px-4 py-2 hover:bg-black/5 transition-colors"
            >
              View document
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="text-xs text-black/40 hover:text-black transition-colors"
            >
              Replace
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="border border-black/15 border-dashed px-6 py-4 text-sm text-black/40 hover:border-black/30 hover:text-black transition-colors w-full text-center"
          >
            {uploading ? 'Uploading…' : '+ Upload client profile (PDF, Word, or text)'}
          </button>
        )}
      </div>

      {status && <p className="text-xs text-black/50 mb-6">{status}</p>}

      <div className="border-t border-black/8 pt-6 flex items-center gap-3">
        <button
          onClick={sendInvite}
          disabled={inviting}
          className="border border-black/20 px-5 py-2 text-sm hover:bg-black hover:text-white transition-colors disabled:opacity-40"
        >
          {inviting ? 'Sending…' : 'Send invite'}
        </button>
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-xs text-red-400 hover:text-red-600 transition-colors ml-auto"
          >
            Delete client
          </button>
        ) : (
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-black/50">Are you sure?</span>
            <button onClick={deleteClient} className="text-xs text-red-600 font-medium hover:underline">
              Yes, delete
            </button>
            <button onClick={() => setConfirmDelete(false)} className="text-xs text-black/40 hover:text-black">
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
