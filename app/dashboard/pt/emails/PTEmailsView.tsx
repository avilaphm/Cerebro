'use client';

import { useMemo, useState } from 'react';
import { Check, Copy, Mail, Send, Sparkles } from 'lucide-react';
import type { PTClient } from '@/utils/pt/types';

type EmailKind = 'weekly_reset' | 'session_follow_up' | 'nutrition_check' | 'accountability' | 'custom';
type EmailTone = 'direct' | 'warm' | 'firm';

export interface PTEmailNotification {
  id: string;
  created_at: string;
  client_id: string | null;
  notification_type: string;
  recipient_email: string;
  subject: string;
  pt_clients: { name: string } | null;
}

interface EmailDraft {
  subject: string;
  body: string;
}

const EMAIL_KINDS: Array<{ key: EmailKind; label: string; description: string }> = [
  { key: 'weekly_reset', label: 'Weekly reset', description: 'Reset focus, training, recovery, and next actions.' },
  { key: 'session_follow_up', label: 'Session follow-up', description: 'Send the useful notes straight after a session.' },
  { key: 'nutrition_check', label: 'Nutrition check', description: 'Keep food habits simple, specific, and accountable.' },
  { key: 'accountability', label: 'Accountability', description: 'Bring a drifting client back without over-explaining.' },
  { key: 'custom', label: 'Custom', description: 'Start clean and write the exact email you need.' },
];

const TONES: Array<{ key: EmailTone; label: string }> = [
  { key: 'direct', label: 'Direct' },
  { key: 'warm', label: 'Warm' },
  { key: 'firm', label: 'Firm' },
];

function firstName(client: PTClient | null) {
  return client?.name.split(' ')[0] ?? 'there';
}

function clientContext(client: PTClient | null) {
  const parts = [
    client?.goals ? `Goal: ${client.goals}` : null,
    client?.coaching_focus ? `Focus: ${client.coaching_focus}` : null,
    client?.event_goal ? `Event: ${client.event_goal}` : null,
    client ? `Sessions left: ${client.sessions_remaining}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join('\n') : 'No client context available yet.';
}

function toneClose(tone: EmailTone) {
  if (tone === 'warm') return 'You are doing better than you think. Keep it simple and send me the update when you have it.';
  if (tone === 'firm') return 'Reply with the update today so I can keep the plan accurate.';
  return 'Reply with the update when you can and I will adjust from there.';
}

function buildDraft(kind: EmailKind, tone: EmailTone, client: PTClient | null, notes: string): EmailDraft {
  const name = firstName(client);
  const detail = notes.trim();
  const detailLine = detail ? `\n\nA few specifics I want you to keep in mind:\n${detail}` : '';

  switch (kind) {
    case 'weekly_reset':
      return {
        subject: `${name}, your focus for this week`,
        body: `Hey ${name},\n\nQuick reset for the week.\n\nYour job is to keep the main thing the main thing: hit the planned sessions, keep recovery boring and repeatable, and send me the honest signals early instead of waiting until the end of the week.${detailLine}\n\n${toneClose(tone)}\n\nPedro`,
      };
    case 'session_follow_up':
      return {
        subject: `${name}, notes from today`,
        body: `Hey ${name},\n\nGood work today.\n\nThe thing I want you to take from the session is not just what we did, but what we were trying to change. Keep the next session focused on the same cues and do not chase extra volume just because it feels available.${detailLine}\n\n${toneClose(tone)}\n\nPedro`,
      };
    case 'nutrition_check':
      return {
        subject: `${name}, quick nutrition check`,
        body: `Hey ${name},\n\nQuick nutrition check.\n\nSend me the honest version of how the last few days have looked: protein, meals, alcohol, snacks, eating out, and anything that made the plan harder than expected.${detailLine}\n\n${toneClose(tone)}\n\nPedro`,
      };
    case 'accountability':
      return {
        subject: `${name}, quick check-in`,
        body: `Hey ${name},\n\nI want to pull this back into focus before it turns into a bigger gap.\n\nSend me what actually happened this week, what got missed, and what is realistic over the next 48 hours. We do not need drama around it, we just need the next clean step.${detailLine}\n\n${toneClose(tone)}\n\nPedro`,
      };
    case 'custom':
      return {
        subject: client ? `${name}, quick note` : '',
        body: client ? `Hey ${name},\n\n${detail}\n\nPedro` : detail,
      };
  }
}

function mailtoHref(client: PTClient | null, draft: EmailDraft) {
  if (!client?.email || !draft.subject.trim() || !draft.body.trim()) return '';
  const params = new URLSearchParams({ subject: draft.subject, body: draft.body });
  return `mailto:${client.email}?${params.toString()}`;
}

function notificationLabel(type: string) {
  return type.replace(/_/g, ' ');
}

export default function PTEmailsView({
  clients,
  recentNotifications,
}: {
  clients: PTClient[];
  recentNotifications: PTEmailNotification[];
}) {
  const [selectedClientId, setSelectedClientId] = useState(clients[0]?.id ?? '');
  const [kind, setKind] = useState<EmailKind>('weekly_reset');
  const [tone, setTone] = useState<EmailTone>('direct');
  const [notes, setNotes] = useState('');
  const [manualDraft, setManualDraft] = useState<EmailDraft | null>(null);
  const [copied, setCopied] = useState<'subject' | 'body' | 'all' | null>(null);

  const selectedClient = clients.find((client) => client.id === selectedClientId) ?? null;
  const generatedDraft = useMemo(
    () => buildDraft(kind, tone, selectedClient, notes),
    [kind, notes, selectedClient, tone],
  );
  const draft = manualDraft ?? generatedDraft;
  const href = mailtoHref(selectedClient, draft);

  const updateKind = (nextKind: EmailKind) => {
    setKind(nextKind);
    setManualDraft(null);
  };

  const updateTone = (nextTone: EmailTone) => {
    setTone(nextTone);
    setManualDraft(null);
  };

  const updateSubject = (subject: string) => {
    setManualDraft((current) => ({ ...(current ?? generatedDraft), subject }));
  };

  const updateBody = (body: string) => {
    setManualDraft((current) => ({ ...(current ?? generatedDraft), body }));
  };

  const copyText = async (value: string, target: 'subject' | 'body' | 'all') => {
    await navigator.clipboard.writeText(value);
    setCopied(target);
    window.setTimeout(() => setCopied(null), 1600);
  };

  return (
    <div className="max-w-7xl px-5 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <div className="mb-8 flex flex-col gap-4 lg:mb-10 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-1 text-[0.6rem] font-medium uppercase tracking-[0.2em] text-black/35">PT</p>
          <h1 className="font-display text-3xl font-light tracking-[-0.02em]">Email</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void copyText(`${draft.subject}\n\n${draft.body}`, 'all')}
            disabled={!draft.subject.trim() || !draft.body.trim()}
            className="inline-flex items-center justify-center gap-2 border border-black/15 px-4 py-2.5 text-sm text-black transition-colors hover:border-black/35 disabled:opacity-35"
          >
            {copied === 'all' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            Copy email
          </button>
          <a
            href={href || undefined}
            aria-disabled={!href}
            className={`inline-flex items-center justify-center gap-2 border border-black bg-black px-4 py-2.5 text-sm text-white transition-colors hover:bg-white hover:text-black ${
              href ? '' : 'pointer-events-none opacity-35'
            }`}
          >
            <Send className="h-4 w-4" />
            Open draft
          </a>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)_minmax(16rem,18rem)]">
        <section className="border border-black/10 bg-white">
          <div className="border-b border-black/8 px-4 py-4">
            <h2 className="text-[0.6rem] font-medium uppercase tracking-[0.2em] text-black/35">Client</h2>
          </div>
          <div className="p-4">
            <select
              value={selectedClientId}
              onChange={(event) => {
                setSelectedClientId(event.target.value);
                setManualDraft(null);
              }}
              className="w-full border border-black/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-black/40"
            >
              {clients.length === 0 ? (
                <option value="">No active clients</option>
              ) : (
                clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name} - {client.email}
                  </option>
                ))
              )}
            </select>

            <div className="mt-5 border border-black/8 bg-black/[0.02] p-4">
              <p className="text-sm font-medium">{selectedClient?.name ?? 'No client selected'}</p>
              <p className="mt-1 break-all text-xs text-black/40">{selectedClient?.email ?? 'Choose a client to create an email.'}</p>
              <pre className="mt-4 whitespace-pre-wrap font-sans text-xs leading-relaxed text-black/45">{clientContext(selectedClient)}</pre>
            </div>
          </div>
        </section>

        <main className="border border-black/10 bg-white">
          <div className="grid border-b border-black/8 md:grid-cols-[13rem_1fr]">
            <div className="border-b border-black/8 p-4 md:border-b-0 md:border-r">
              <h2 className="text-[0.6rem] font-medium uppercase tracking-[0.2em] text-black/35">Purpose</h2>
            </div>
            <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-5">
              {EMAIL_KINDS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => updateKind(item.key)}
                  className={`min-h-20 border px-3 py-3 text-left transition-colors ${
                    kind === item.key
                      ? 'border-black bg-black text-white'
                      : 'border-black/10 text-black hover:border-black/30'
                  }`}
                >
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className={`mt-1 block text-[0.68rem] leading-snug ${kind === item.key ? 'text-white/60' : 'text-black/35'}`}>
                    {item.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_11rem] lg:p-5">
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-[0.6rem] font-medium uppercase tracking-[0.18em] text-black/35">
                  Specific notes
                </label>
                <textarea
                  value={notes}
                  onChange={(event) => {
                    setNotes(event.target.value);
                    setManualDraft(null);
                  }}
                  placeholder="Add the exact thing this client needs to hear: missed sessions, food logs, pain update, next step..."
                  rows={4}
                  className="w-full resize-y border border-black/15 px-3 py-3 text-sm leading-relaxed outline-none focus:border-black/40"
                />
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <label className="block text-[0.6rem] font-medium uppercase tracking-[0.18em] text-black/35">Subject</label>
                  <button
                    type="button"
                    onClick={() => void copyText(draft.subject, 'subject')}
                    className="inline-flex items-center gap-1.5 text-xs text-black/35 transition-colors hover:text-black"
                  >
                    {copied === 'subject' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    Copy
                  </button>
                </div>
                <input
                  value={draft.subject}
                  onChange={(event) => updateSubject(event.target.value)}
                  className="w-full border border-black/15 px-3 py-3 text-sm outline-none focus:border-black/40"
                />
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <label className="block text-[0.6rem] font-medium uppercase tracking-[0.18em] text-black/35">Body</label>
                  <button
                    type="button"
                    onClick={() => void copyText(draft.body, 'body')}
                    className="inline-flex items-center gap-1.5 text-xs text-black/35 transition-colors hover:text-black"
                  >
                    {copied === 'body' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    Copy
                  </button>
                </div>
                <textarea
                  value={draft.body}
                  onChange={(event) => updateBody(event.target.value)}
                  rows={15}
                  className="w-full resize-y border border-black/15 px-3 py-3 text-sm leading-relaxed outline-none focus:border-black/40"
                />
              </div>
            </div>

            <aside className="space-y-3">
              <div>
                <h3 className="mb-2 text-[0.6rem] font-medium uppercase tracking-[0.18em] text-black/35">Tone</h3>
                <div className="grid gap-2">
                  {TONES.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => updateTone(item.key)}
                      className={`border px-3 py-2 text-left text-sm transition-colors ${
                        tone === item.key
                          ? 'border-black bg-black text-white'
                          : 'border-black/10 text-black/50 hover:border-black/30 hover:text-black'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setManualDraft(buildDraft(kind, tone, selectedClient, notes))}
                className="inline-flex w-full items-center justify-center gap-2 border border-black/15 px-3 py-2.5 text-sm transition-colors hover:border-black/35"
              >
                <Sparkles className="h-4 w-4" />
                Reset draft
              </button>
            </aside>
          </div>
        </main>

        <aside className="border border-black/10 bg-white">
          <div className="border-b border-black/8 px-4 py-4">
            <h2 className="text-[0.6rem] font-medium uppercase tracking-[0.2em] text-black/35">Recent sends</h2>
          </div>
          <div className="divide-y divide-black/8">
            {recentNotifications.length === 0 ? (
              <p className="px-4 py-5 text-sm text-black/35">No logged PT emails yet.</p>
            ) : (
              recentNotifications.map((notification) => (
                <div key={notification.id} className="px-4 py-3.5">
                  <div className="mb-1 flex items-center gap-2 text-[0.6rem] uppercase tracking-[0.14em] text-black/30">
                    <Mail className="h-3.5 w-3.5" />
                    <span>{notificationLabel(notification.notification_type)}</span>
                  </div>
                  <p className="text-sm font-medium leading-snug">{notification.subject}</p>
                  <p className="mt-1 truncate text-xs text-black/40">
                    {notification.pt_clients?.name ?? notification.recipient_email}
                  </p>
                  <p className="mt-1 text-[0.68rem] text-black/25">
                    {new Date(notification.created_at).toLocaleDateString('en-AU', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
