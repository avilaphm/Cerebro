'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Image as ImageIcon,
  Mail,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { createClient } from '@/utils/supabase/client';

type WorkflowKey =
  | 'client_setup_invite'
  | 'client_login_link'
  | 'password_reset'
  | 'booking_confirmation'
  | 'booking_cancelled'
  | 'sessions_left'
  | 'coach_booking_notification'
  | 'weekly_pt_summary'
  | 'lead_chat_welcome'
  | 'lead_proposal';

type EmailBlockType = 'eyebrow' | 'heading' | 'text' | 'button' | 'image' | 'divider' | 'spacer';

interface EmailBlock {
  id: string;
  type: EmailBlockType;
  content: string;
  url?: string;
  alt?: string;
}

interface EmailDesign {
  subject: string;
  preview: string;
  blocks: EmailBlock[];
}

interface WorkflowDefinition {
  key: WorkflowKey;
  label: string;
  owner: 'Supabase Auth' | 'PT Booking' | 'PT Ops' | 'Lead Engine';
  trigger: string;
  destination: string;
  status: 'live-editable' | 'code-owned';
  note: string;
  defaultDesign: EmailDesign;
}

export interface PTEmailNotification {
  id: string;
  created_at: string;
  client_id: string | null;
  notification_type: string;
  recipient_email: string;
  subject: string;
  pt_clients: { name: string } | null;
}

interface InviteTemplateResponse {
  subject?: string;
  html?: string;
}

const CLIENT_SETUP_DEFAULT: EmailDesign = {
  subject: 'Your Pedro Avila Coaching programme',
  preview: 'Create your password and access your programme.',
  blocks: [
    { id: 'intro-eyebrow', type: 'eyebrow', content: 'Pedro Avila Coaching' },
    { id: 'intro-heading', type: 'heading', content: 'Your coaching app is ready.' },
    {
      id: 'intro-copy',
      type: 'text',
      content:
        'Hello, Pedro here. I am inviting you to create a password so you can access your programme and coaching inside Pedro Avila Coaching.',
    },
    {
      id: 'value-copy',
      type: 'text',
      content: 'Once you are in, you will have your training, sessions, check-ins, nutrition notes, and messages in one place.',
    },
    { id: 'cta', type: 'button', content: 'Create your password', url: '{{ .ConfirmationURL }}' },
    { id: 'signoff', type: 'text', content: 'See you inside,\nPedro' },
  ],
};

const WORKFLOWS: WorkflowDefinition[] = [
  {
    key: 'client_setup_invite',
    label: 'New client password setup',
    owner: 'Supabase Auth',
    trigger: '+ Add client or Resend setup link',
    destination: 'Client',
    status: 'live-editable',
    note: 'This is the invite email sent by inviteUserByEmail. Saving here updates the live Supabase Auth invite template.',
    defaultDesign: CLIENT_SETUP_DEFAULT,
  },
  {
    key: 'client_login_link',
    label: 'Returning client login link',
    owner: 'Supabase Auth',
    trigger: 'Resend login link for clients with a password',
    destination: 'Client',
    status: 'code-owned',
    note: 'Uses the Supabase magic-link template. The editor can preview the workflow; live wiring comes next.',
    defaultDesign: {
      subject: 'Your Pedro Avila Coaching login link',
      preview: 'Log back into your coaching app.',
      blocks: [
        { id: 'login-heading', type: 'heading', content: 'Your login link is ready.' },
        { id: 'login-copy', type: 'text', content: 'Use this secure link to get back into your coaching app.' },
        { id: 'login-button', type: 'button', content: 'Open the app', url: '{{ .ConfirmationURL }}' },
      ],
    },
  },
  {
    key: 'password_reset',
    label: 'Password reset',
    owner: 'Supabase Auth',
    trigger: 'Client requests reset from login/settings',
    destination: 'Client',
    status: 'code-owned',
    note: 'Uses the Supabase recovery template. The workflow is visible here but not live-editable yet.',
    defaultDesign: {
      subject: 'Reset your Pedro Avila Coaching password',
      preview: 'Set a new password for your coaching app.',
      blocks: [
        { id: 'reset-heading', type: 'heading', content: 'Reset your password.' },
        { id: 'reset-copy', type: 'text', content: 'Use the button below to set a new password for your account.' },
        { id: 'reset-button', type: 'button', content: 'Reset password', url: '{{ .ConfirmationURL }}' },
      ],
    },
  },
  {
    key: 'booking_confirmation',
    label: 'Booking confirmation',
    owner: 'PT Booking',
    trigger: 'Client books a PT session',
    destination: 'Client',
    status: 'code-owned',
    note: 'Currently sent from manage-pt-booking with Resend text email.',
    defaultDesign: {
      subject: 'Your PT session is booked',
      preview: 'Session time and next step.',
      blocks: [
        { id: 'book-heading', type: 'heading', content: 'Your session is booked.' },
        { id: 'book-copy', type: 'text', content: 'Your session with Pedro is booked. Keep the time clear and bring any training notes into the app.' },
      ],
    },
  },
  {
    key: 'booking_cancelled',
    label: 'Booking cancelled',
    owner: 'PT Booking',
    trigger: 'Session is cancelled',
    destination: 'Client',
    status: 'code-owned',
    note: 'Currently sent from manage-pt-booking with Resend text email.',
    defaultDesign: {
      subject: 'Your PT session was cancelled',
      preview: 'Cancelled session notice.',
      blocks: [
        { id: 'cancel-heading', type: 'heading', content: 'Your session was cancelled.' },
        { id: 'cancel-copy', type: 'text', content: 'Your session with Pedro has been cancelled. Book another available time inside the app.' },
      ],
    },
  },
  {
    key: 'sessions_left',
    label: 'Session-credit alert',
    owner: 'PT Booking',
    trigger: 'A client reaches 3, 2, 1, or 0 sessions left',
    destination: 'Client',
    status: 'code-owned',
    note: 'Currently sent from manage-pt-booking with Resend text email.',
    defaultDesign: {
      subject: 'Your PT session balance',
      preview: 'Session pack balance reminder.',
      blocks: [
        { id: 'credit-heading', type: 'heading', content: 'A quick session-pack reminder.' },
        { id: 'credit-copy', type: 'text', content: 'You are getting close to the end of your current PT session pack. Arrange the next pack with Pedro so training does not stall.' },
      ],
    },
  },
  {
    key: 'coach_booking_notification',
    label: 'Coach booking notice',
    owner: 'PT Booking',
    trigger: 'A client books a PT session',
    destination: 'Pedro',
    status: 'code-owned',
    note: 'Currently sent from manage-pt-booking to Pedro as a coach copy.',
    defaultDesign: {
      subject: '[Cerebro Booking] New PT session',
      preview: 'Coach notification for a new booking.',
      blocks: [
        { id: 'coach-heading', type: 'heading', content: 'New PT session booked.' },
        { id: 'coach-copy', type: 'text', content: 'A client booked a session. The event has been added to the calendar when Google Calendar sync is available.' },
      ],
    },
  },
  {
    key: 'weekly_pt_summary',
    label: 'Weekly PT summary',
    owner: 'PT Ops',
    trigger: 'Weekly PT summary function runs',
    destination: 'Pedro',
    status: 'code-owned',
    note: 'Generated by OpenAI and sent through Resend from weekly-pt-summary.',
    defaultDesign: {
      subject: 'Weekly PT summary',
      preview: 'Generated weekly operations summary.',
      blocks: [
        { id: 'summary-heading', type: 'heading', content: 'Weekly PT summary.' },
        { id: 'summary-copy', type: 'text', content: 'Generated from clients, workouts, sets, and events.' },
      ],
    },
  },
  {
    key: 'lead_chat_welcome',
    label: 'Lead chat welcome',
    owner: 'Lead Engine',
    trigger: 'Website chat captures a qualified lead email',
    destination: 'Lead',
    status: 'code-owned',
    note: 'Sent from chat through Resend when the public chatbot captures a lead.',
    defaultDesign: {
      subject: 'We got your details',
      preview: 'Confirmation email after website chat.',
      blocks: [
        { id: 'lead-heading', type: 'heading', content: 'We got your details.' },
        { id: 'lead-copy', type: 'text', content: 'Pedro will review the chat and follow up with the right next step.' },
      ],
    },
  },
  {
    key: 'lead_proposal',
    label: 'Lead proposal email',
    owner: 'Lead Engine',
    trigger: 'Proposal generation completes',
    destination: 'Lead and Pedro',
    status: 'code-owned',
    note: 'Sent from generate-proposal through Resend with proposal content.',
    defaultDesign: {
      subject: 'Your Cerebro proposal',
      preview: 'Generated proposal email.',
      blocks: [
        { id: 'proposal-heading', type: 'heading', content: 'Your proposal is ready.' },
        { id: 'proposal-copy', type: 'text', content: 'The proposal summarises the workflow opportunities discussed in the website chat.' },
      ],
    },
  },
];

function blockId(type: EmailBlockType) {
  return `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneDesign(design: EmailDesign): EmailDesign {
  return {
    subject: design.subject,
    preview: design.preview,
    blocks: design.blocks.map((block) => ({ ...block })),
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttributePreserveTemplates(value: string) {
  return escapeHtml(value).replace(/%7B%7B/g, '{{').replace(/%7D%7D/g, '}}');
}

function textToHtml(value: string) {
  return escapeHtml(value)
    .split('\n')
    .map((line) => (line.trim() ? line : '&nbsp;'))
    .join('<br>');
}

function renderEmailHtml(design: EmailDesign) {
  const blocks = design.blocks.map((block) => {
    if (block.type === 'eyebrow') {
      return `<p style="margin:0 0 14px 0;color:#777;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;">${textToHtml(block.content)}</p>`;
    }
    if (block.type === 'heading') {
      return `<h1 style="margin:0 0 18px 0;color:#111;font-size:30px;line-height:1.08;font-weight:400;">${textToHtml(block.content)}</h1>`;
    }
    if (block.type === 'text') {
      return `<p style="margin:0 0 18px 0;color:#2f2f2f;font-size:16px;line-height:1.65;">${textToHtml(block.content)}</p>`;
    }
    if (block.type === 'button') {
      const url = block.url?.trim() || '{{ .ConfirmationURL }}';
      return `<p style="margin:28px 0;"><a href="${escapeAttributePreserveTemplates(url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:14px 22px;border-radius:0;font-size:14px;font-weight:600;">${textToHtml(block.content || 'Open link')}</a></p>`;
    }
    if (block.type === 'image') {
      if (!block.url?.trim()) return '';
      return `<figure style="margin:26px 0;"><img src="${escapeAttributePreserveTemplates(block.url.trim())}" alt="${escapeHtml(block.alt ?? '')}" style="display:block;width:100%;max-width:560px;height:auto;border:0;"><figcaption style="margin-top:9px;color:#777;font-size:12px;line-height:1.5;">${textToHtml(block.content)}</figcaption></figure>`;
    }
    if (block.type === 'divider') {
      return '<hr style="border:0;border-top:1px solid #e7e2dc;margin:28px 0;">';
    }
    return '<div style="height:22px;line-height:22px;">&nbsp;</div>';
  }).join('\n');

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f2ec;">
    <div style="display:none;max-height:0;overflow:hidden;color:transparent;">${escapeHtml(design.preview)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f2ec;padding:28px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border:1px solid #e8e0d7;">
            <tr>
              <td style="padding:44px 40px 38px 40px;font-family:Arial,Helvetica,sans-serif;">
${blocks}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function designFromInviteHtml(subject?: string, html?: string): EmailDesign {
  if (!html) return cloneDesign(CLIENT_SETUP_DEFAULT);
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const blocks: EmailBlock[] = [];
  const h1 = doc.querySelector('h1, h2');
  const paragraphs = Array.from(doc.querySelectorAll('p'));
  const image = doc.querySelector('img');
  const link = doc.querySelector('a[href]');

  blocks.push({ id: 'loaded-eyebrow', type: 'eyebrow', content: 'Pedro Avila Coaching' });
  blocks.push({ id: 'loaded-heading', type: 'heading', content: h1?.textContent?.trim() || CLIENT_SETUP_DEFAULT.blocks[1].content });

  paragraphs
    .filter((paragraph) => !paragraph.querySelector('a'))
    .map((paragraph) => paragraph.textContent?.trim())
    .filter((text): text is string => Boolean(text))
    .slice(0, 4)
    .forEach((content, index) => {
      blocks.push({ id: `loaded-copy-${index}`, type: 'text', content });
    });

  if (image?.getAttribute('src')) {
    blocks.splice(2, 0, {
      id: 'loaded-image',
      type: 'image',
      url: image.getAttribute('src') ?? '',
      alt: image.getAttribute('alt') ?? '',
      content: '',
    });
  }

  blocks.push({
    id: 'loaded-cta',
    type: 'button',
    content: link?.textContent?.trim() || 'Create your password',
    url: link?.getAttribute('href') || '{{ .ConfirmationURL }}',
  });

  if (!blocks.some((block) => block.type === 'text' && block.content.includes('Pedro'))) {
    blocks.push({ id: 'loaded-signoff', type: 'text', content: 'See you inside,\nPedro' });
  }

  return {
    subject: subject || CLIENT_SETUP_DEFAULT.subject,
    preview: CLIENT_SETUP_DEFAULT.preview,
    blocks,
  };
}

function notificationLabel(type: string) {
  return type.replace(/_/g, ' ');
}

export default function PTEmailsView({
  recentNotifications,
}: {
  recentNotifications: PTEmailNotification[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [selectedKey, setSelectedKey] = useState<WorkflowKey>('client_setup_invite');
  const [designs, setDesigns] = useState<Record<WorkflowKey, EmailDesign>>(() =>
    Object.fromEntries(WORKFLOWS.map((workflow) => [workflow.key, cloneDesign(workflow.defaultDesign)])) as Record<WorkflowKey, EmailDesign>,
  );
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const workflow = WORKFLOWS.find((item) => item.key === selectedKey) ?? WORKFLOWS[0];
  const design = designs[selectedKey];
  const html = useMemo(() => renderEmailHtml(design), [design]);

  useEffect(() => {
    let mounted = true;

    const loadInviteTemplate = async () => {
      const { data, error } = await supabase.functions.invoke<InviteTemplateResponse>('manage-email-template', {
        body: { action: 'get', template: 'invite' },
      });
      if (!mounted) return;
      if (error) {
        setStatus(`Live invite template could not be loaded: ${error.message}`);
        return;
      }
      setDesigns((current) => ({
        ...current,
        client_setup_invite: designFromInviteHtml(data?.subject, data?.html),
      }));
    };

    void loadInviteTemplate();
    return () => {
      mounted = false;
    };
  }, [supabase]);

  const patchDesign = (patch: Partial<EmailDesign>) => {
    setDesigns((current) => ({
      ...current,
      [selectedKey]: { ...current[selectedKey], ...patch },
    }));
  };

  const patchBlock = (id: string, patch: Partial<EmailBlock>) => {
    patchDesign({
      blocks: design.blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)),
    });
  };

  const addBlock = (type: EmailBlockType) => {
    const defaults: Record<EmailBlockType, EmailBlock> = {
      eyebrow: { id: blockId(type), type, content: 'Pedro Avila Coaching' },
      heading: { id: blockId(type), type, content: 'A clear email heading' },
      text: { id: blockId(type), type, content: 'Write the email section here.' },
      button: { id: blockId(type), type, content: 'Create your password', url: '{{ .ConfirmationURL }}' },
      image: { id: blockId(type), type, content: '', url: '', alt: '' },
      divider: { id: blockId(type), type, content: '' },
      spacer: { id: blockId(type), type, content: '' },
    };
    patchDesign({ blocks: [...design.blocks, defaults[type]] });
  };

  const removeBlock = (id: string) => {
    patchDesign({ blocks: design.blocks.filter((block) => block.id !== id) });
  };

  const moveBlock = (id: string, direction: -1 | 1) => {
    const index = design.blocks.findIndex((block) => block.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= design.blocks.length) return;
    const next = [...design.blocks];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    patchDesign({ blocks: next });
  };

  const saveLiveTemplate = async () => {
    if (workflow.status !== 'live-editable') return;
    if (!html.includes('{{ .ConfirmationURL }}')) {
      setStatus('The live invite email must include {{ .ConfirmationURL }} in a button link.');
      return;
    }
    setSaving(true);
    setStatus('Saving live invite template...');
    const { error } = await supabase.functions.invoke('manage-email-template', {
      body: {
        action: 'update',
        template: 'invite',
        subject: design.subject,
        html,
      },
    });
    setSaving(false);
    setStatus(error ? error.message : 'Live invite email template saved.');
  };

  const copyHtml = async () => {
    await navigator.clipboard.writeText(html);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="max-w-7xl px-5 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-1 text-[0.6rem] font-medium uppercase tracking-[0.2em] text-black/35">PT</p>
          <h1 className="font-display text-3xl font-light tracking-[-0.02em]">Email workflow editor</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void copyHtml()}
            className="inline-flex items-center justify-center gap-2 border border-black/15 px-4 py-2.5 text-sm transition-colors hover:border-black/35"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            Copy HTML
          </button>
          <button
            type="button"
            onClick={() => void saveLiveTemplate()}
            disabled={saving || workflow.status !== 'live-editable'}
            className="inline-flex items-center justify-center gap-2 border border-black bg-black px-4 py-2.5 text-sm text-white transition-colors hover:bg-white hover:text-black disabled:pointer-events-none disabled:opacity-35"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : 'Save live template'}
          </button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[18rem_minmax(0,1fr)_24rem]">
        <aside className="border border-black/10 bg-white">
          <div className="border-b border-black/8 px-4 py-4">
            <h2 className="text-[0.6rem] font-medium uppercase tracking-[0.2em] text-black/35">Live workflows</h2>
          </div>
          <div className="divide-y divide-black/8">
            {WORKFLOWS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setSelectedKey(item.key)}
                className={`block w-full px-4 py-4 text-left transition-colors ${
                  item.key === selectedKey ? 'bg-black text-white' : 'hover:bg-black/[0.03]'
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium leading-tight">{item.label}</span>
                  <span className={`shrink-0 border px-1.5 py-0.5 text-[0.55rem] uppercase tracking-[0.12em] ${
                    item.status === 'live-editable'
                      ? item.key === selectedKey ? 'border-white/30 text-white/70' : 'border-green-200 text-green-700'
                      : item.key === selectedKey ? 'border-white/25 text-white/45' : 'border-black/10 text-black/30'
                  }`}>
                    {item.status === 'live-editable' ? 'Live' : 'View'}
                  </span>
                </div>
                <p className={`text-[0.68rem] leading-snug ${item.key === selectedKey ? 'text-white/55' : 'text-black/40'}`}>
                  {item.trigger}
                </p>
              </button>
            ))}
          </div>
        </aside>

        <main className="border border-black/10 bg-white">
          <div className="border-b border-black/8 px-5 py-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="border border-black/10 px-2 py-1 text-[0.6rem] uppercase tracking-[0.16em] text-black/40">
                {workflow.owner}
              </span>
              <span className="border border-black/10 px-2 py-1 text-[0.6rem] uppercase tracking-[0.16em] text-black/40">
                To {workflow.destination}
              </span>
            </div>
            <h2 className="text-xl font-medium">{workflow.label}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-black/45">{workflow.note}</p>
            {status && <p className="mt-3 text-xs text-black/45">{status}</p>}
          </div>

          <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_13rem]">
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-[0.6rem] font-medium uppercase tracking-[0.18em] text-black/35">Subject</label>
                <input
                  value={design.subject}
                  onChange={(event) => patchDesign({ subject: event.target.value })}
                  className="w-full border border-black/15 px-3 py-3 text-sm outline-none focus:border-black/40"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[0.6rem] font-medium uppercase tracking-[0.18em] text-black/35">Preview line</label>
                <input
                  value={design.preview}
                  onChange={(event) => patchDesign({ preview: event.target.value })}
                  className="w-full border border-black/15 px-3 py-3 text-sm outline-none focus:border-black/40"
                />
              </div>

              <div className="space-y-3">
                {design.blocks.map((block, index) => (
                  <div key={block.id} className="border border-black/10 bg-black/[0.015] p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <span className="text-[0.6rem] font-medium uppercase tracking-[0.16em] text-black/35">{block.type}</span>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => moveBlock(block.id, -1)} disabled={index === 0} className="p-1.5 text-black/35 hover:text-black disabled:opacity-20">
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => moveBlock(block.id, 1)} disabled={index === design.blocks.length - 1} className="p-1.5 text-black/35 hover:text-black disabled:opacity-20">
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => removeBlock(block.id)} className="p-1.5 text-black/35 hover:text-red-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {block.type === 'image' ? (
                      <div className="grid gap-2">
                        <input
                          value={block.url ?? ''}
                          onChange={(event) => patchBlock(block.id, { url: event.target.value })}
                          placeholder="Photo or GIF URL"
                          className="w-full border border-black/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-black/40"
                        />
                        <input
                          value={block.alt ?? ''}
                          onChange={(event) => patchBlock(block.id, { alt: event.target.value })}
                          placeholder="Alt text"
                          className="w-full border border-black/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-black/40"
                        />
                        <input
                          value={block.content}
                          onChange={(event) => patchBlock(block.id, { content: event.target.value })}
                          placeholder="Optional caption"
                          className="w-full border border-black/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-black/40"
                        />
                      </div>
                    ) : block.type === 'button' ? (
                      <div className="grid gap-2">
                        <input
                          value={block.content}
                          onChange={(event) => patchBlock(block.id, { content: event.target.value })}
                          placeholder="Button label"
                          className="w-full border border-black/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-black/40"
                        />
                        <input
                          value={block.url ?? ''}
                          onChange={(event) => patchBlock(block.id, { url: event.target.value })}
                          placeholder="{{ .ConfirmationURL }}"
                          className="w-full border border-black/15 bg-white px-3 py-2.5 font-mono text-xs outline-none focus:border-black/40"
                        />
                      </div>
                    ) : block.type === 'divider' || block.type === 'spacer' ? (
                      <p className="text-xs text-black/35">{block.type === 'divider' ? 'Divider line' : 'Whitespace block'}</p>
                    ) : (
                      <textarea
                        value={block.content}
                        onChange={(event) => patchBlock(block.id, { content: event.target.value })}
                        rows={block.type === 'heading' ? 2 : 4}
                        className="w-full resize-y border border-black/15 bg-white px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-black/40"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <aside className="space-y-2">
              <h3 className="mb-2 text-[0.6rem] font-medium uppercase tracking-[0.18em] text-black/35">Add block</h3>
              {[
                ['heading', 'Heading'],
                ['text', 'Text'],
                ['button', 'Button'],
                ['image', 'Photo / GIF'],
                ['divider', 'Divider'],
                ['spacer', 'Spacer'],
              ].map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => addBlock(type as EmailBlockType)}
                  className="flex w-full items-center justify-between border border-black/10 px-3 py-2.5 text-left text-sm transition-colors hover:border-black/35"
                >
                  <span>{label}</span>
                  {type === 'image' ? <ImageIcon className="h-4 w-4 text-black/35" /> : <Plus className="h-4 w-4 text-black/35" />}
                </button>
              ))}
              <button
                type="button"
                onClick={() => patchDesign(cloneDesign(workflow.defaultDesign))}
                className="mt-4 flex w-full items-center justify-center gap-2 border border-black/15 px-3 py-2.5 text-sm transition-colors hover:border-black/35"
              >
                <Sparkles className="h-4 w-4" />
                Reset workflow
              </button>
            </aside>
          </div>
        </main>

        <aside className="space-y-5">
          <section className="border border-black/10 bg-[#f6f2ec] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[0.6rem] font-medium uppercase tracking-[0.2em] text-black/35">Preview</h2>
              <Mail className="h-4 w-4 text-black/25" />
            </div>
            <div className="mx-auto max-w-[330px] border border-black/10 bg-white shadow-sm">
              <div className="border-b border-black/8 px-4 py-3">
                <p className="truncate text-sm font-medium">{design.subject}</p>
                <p className="mt-0.5 truncate text-xs text-black/35">{design.preview}</p>
              </div>
              <div className="space-y-3 px-5 py-5">
                {design.blocks.map((block) => {
                  if (block.type === 'eyebrow') return <p key={block.id} className="text-[0.58rem] uppercase tracking-[0.18em] text-black/35">{block.content}</p>;
                  if (block.type === 'heading') return <h3 key={block.id} className="text-2xl font-light leading-tight">{block.content}</h3>;
                  if (block.type === 'text') return <p key={block.id} className="whitespace-pre-wrap text-sm leading-relaxed text-black/65">{block.content}</p>;
                  if (block.type === 'button') return <span key={block.id} className="inline-block bg-black px-4 py-2.5 text-sm text-white">{block.content || 'Open link'}</span>;
                  if (block.type === 'image') {
                    return block.url ? (
                      <figure key={block.id}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={block.url} alt={block.alt ?? ''} className="w-full border border-black/8 object-cover" />
                        {block.content && <figcaption className="mt-1.5 text-xs text-black/40">{block.content}</figcaption>}
                      </figure>
                    ) : (
                      <div key={block.id} className="flex aspect-[4/3] items-center justify-center border border-dashed border-black/15 text-xs text-black/30">Photo / GIF</div>
                    );
                  }
                  if (block.type === 'divider') return <div key={block.id} className="h-px bg-black/10" />;
                  return <div key={block.id} className="h-5" />;
                })}
              </div>
            </div>
          </section>

          <section className="border border-black/10 bg-white">
            <div className="border-b border-black/8 px-4 py-4">
              <h2 className="text-[0.6rem] font-medium uppercase tracking-[0.2em] text-black/35">Recent sends</h2>
            </div>
            <div className="max-h-[30rem] divide-y divide-black/8 overflow-y-auto">
              {recentNotifications.length === 0 ? (
                <p className="px-4 py-5 text-sm text-black/35">No logged PT emails yet.</p>
              ) : (
                recentNotifications.map((notification) => (
                  <div key={notification.id} className="px-4 py-3.5">
                    <p className="text-[0.6rem] uppercase tracking-[0.14em] text-black/30">
                      {notificationLabel(notification.notification_type)}
                    </p>
                    <p className="mt-1 text-sm font-medium leading-snug">{notification.subject}</p>
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
          </section>
        </aside>
      </div>
    </div>
  );
}
