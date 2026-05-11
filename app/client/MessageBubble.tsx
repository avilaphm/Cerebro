'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

interface Message {
  id: string;
  sender: 'pt' | 'client';
  content: string;
  created_at: string;
  context?: {
    phase_title?: string;
    day_title?: string;
  } | null;
}

interface WorkoutContext {
  assignment_id: string;
  assignment_name: string;
  phase_index: number;
  phase_title: string;
  day_index: number;
  day_title: string;
}

interface Props {
  clientId: string;
  workoutContext: WorkoutContext | null;
}

export default function MessageBubble({ clientId, workoutContext }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const mergeMessages = useCallback((incoming: Message[]) => {
    setMessages((current) => {
      const byId = new Map<string, Message>();
      [...current, ...incoming].forEach((message) => byId.set(message.id, message));
      return Array.from(byId.values()).sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
    });
  }, []);

  const loadMessages = useCallback(async () => {
    const { data } = await supabase
      .from('pt_messages')
      .select('id, sender, content, created_at, context')
      .eq('client_id', clientId)
      .order('created_at', { ascending: true });
    mergeMessages((data ?? []) as Message[]);
  }, [clientId, mergeMessages, supabase]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });

    void supabase
      .from('pt_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('client_id', clientId)
      .eq('sender', 'pt')
      .is('read_at', null);

    setUnread(0);
  }, [clientId, messages.length, open, supabase]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadMessages();
    }, open ? 2500 : 10000);
    return () => window.clearInterval(interval);
  }, [loadMessages, open]);

  useEffect(() => {
    const channel = supabase
      .channel(`client-messages-${clientId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'pt_messages', filter: `client_id=eq.${clientId}` },
        (payload) => {
          const msg = payload.new as Message;
          mergeMessages([msg]);
          if (msg.sender === 'pt' && !open) {
            setUnread((n) => n + 1);
          }
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [clientId, mergeMessages, open, supabase]);

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    const content = text.trim();
    setText('');

    const { data: inserted, error } = await supabase
      .from('pt_messages')
      .insert({
        client_id: clientId,
        sender: 'client',
        content,
        context: workoutContext ?? null,
      })
      .select('id, sender, content, created_at, context')
      .single();

    if (error) {
      setText(content);
      setSending(false);
      return;
    }

    if (inserted) {
      const message = inserted as Message;
      mergeMessages([message]);
      setSending(false);

      void supabase.functions.invoke('extract-client-note', {
        body: {
          message_id: message.id,
          client_id: clientId,
          content,
          context: workoutContext,
        },
      });
      return;
    }

    setSending(false);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-black text-white shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
        aria-label="Open messages"
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 4h14a1 1 0 011 1v9a1 1 0 01-1 1H7l-4 4V5a1 1 0 011-1z" />
          </svg>
        )}
        {unread > 0 && !open && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[0.6rem] font-bold flex items-center justify-center">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-0 bottom-0 z-50 flex h-[82svh] flex-col overflow-hidden rounded-t-2xl border border-black/10 bg-white shadow-2xl sm:inset-auto sm:bottom-24 sm:right-6 sm:h-auto sm:max-h-[70vh] sm:w-96 sm:rounded-2xl">
          <div className="px-4 py-3 border-b border-black/8 flex items-center justify-between shrink-0">
            <div>
              <p className="text-sm font-medium">Message your coach</p>
              {workoutContext && (
                <p className="text-[0.6rem] uppercase tracking-[0.12em] text-black/35 mt-0.5">
                  {workoutContext.phase_title} · {workoutContext.day_title}
                </p>
              )}
            </div>
            <button type="button" onClick={() => setOpen(false)} className="text-black/30 hover:text-black transition-colors">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 3l10 10M13 3L3 13" />
              </svg>
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-3">
            {messages.length === 0 ? (
              <p className="text-xs text-black/30 text-center py-6">
                Ask your coach anything. Let them know how you feel, if something hurts, or if you need to reschedule.
              </p>
            ) : (
              messages.map((m) => {
                const isClient = m.sender === 'client';
                return (
                  <div key={m.id} className={`flex ${isClient ? 'justify-end' : 'justify-start'} mb-1`}>
                    <div className={`max-w-[85%] flex flex-col gap-0.5 ${isClient ? 'items-end' : 'items-start'}`}>
                      {m.context?.day_title && isClient && (
                        <span className="text-[0.55rem] uppercase tracking-[0.12em] text-black/30">
                          {m.context.phase_title && `${m.context.phase_title} · `}{m.context.day_title}
                        </span>
                      )}
                      <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                        isClient
                          ? 'bg-black text-white rounded-br-sm'
                          : 'bg-[#f0f0ec] text-black rounded-bl-sm'
                      }`}>
                        {m.content}
                      </div>
                      <span className="text-[0.55rem] text-black/25 px-1">{formatTime(m.created_at)}</span>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          <div className="flex shrink-0 gap-2 border-t border-black/8 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Type a message…"
              rows={1}
              className="flex-1 resize-none border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/30 rounded-xl"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={!text.trim() || sending}
              className="bg-black text-white px-3 py-2 text-sm rounded-xl disabled:opacity-30"
            >
              {sending ? '…' : '↑'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
