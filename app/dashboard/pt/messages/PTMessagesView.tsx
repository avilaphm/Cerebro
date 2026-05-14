'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import type { PTClient } from '@/utils/pt/types';

interface Message {
  id: string;
  client_id: string;
  sender: 'pt' | 'client';
  content: string;
  read_at: string | null;
  created_at: string;
  context?: {
    assignment_name?: string;
    phase_title?: string;
    day_title?: string;
  } | null;
}

interface Props {
  clients: PTClient[];
  unreadByClient: Record<string, number>;
  lastMessageByClient: Record<string, { content: string; created_at: string; sender: string }>;
}

export default function PTMessagesView({ clients, unreadByClient, lastMessageByClient }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(
    clients[0]?.id ?? null,
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [unread, setUnread] = useState(unreadByClient);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  const selectedClient = clients.find((c) => c.id === selectedClientId) ?? null;

  const mergeMessages = useCallback((incoming: Message[]) => {
    setMessages((current) => {
      const byId = new Map<string, Message>();
      [...current, ...incoming].forEach((message) => byId.set(message.id, message));
      return Array.from(byId.values()).sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
    });
  }, []);

  const loadMessages = useCallback(async (clientId: string, showLoading = true) => {
    if (showLoading) setLoading(true);
    const { data } = await supabase
      .from('pt_messages')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: true });
    mergeMessages((data ?? []) as Message[]);
    if (showLoading) setLoading(false);

    await supabase
      .from('pt_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('client_id', clientId)
      .eq('sender', 'client')
      .is('read_at', null);

    setUnread((prev) => ({ ...prev, [clientId]: 0 }));
  }, [mergeMessages, supabase]);

  useEffect(() => {
    if (!selectedClientId) return;
    void loadMessages(selectedClientId);
  }, [loadMessages, selectedClientId]);

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!selectedClientId) return;
    const interval = window.setInterval(() => {
      void loadMessages(selectedClientId, false);
    }, 3000);
    return () => window.clearInterval(interval);
  }, [loadMessages, selectedClientId]);

  useEffect(() => {
    const channel = supabase
      .channel('pt-messages-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'pt_messages' },
        (payload) => {
          const msg = payload.new as Message;
          if (msg.client_id === selectedClientId) {
            mergeMessages([msg]);
            void supabase
              .from('pt_messages')
              .update({ read_at: new Date().toISOString() })
              .eq('id', msg.id);
          } else if (msg.sender === 'client') {
            setUnread((prev) => ({ ...prev, [msg.client_id]: (prev[msg.client_id] ?? 0) + 1 }));
          }
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [mergeMessages, selectedClientId, supabase]);

  const send = async () => {
    if (!text.trim() || !selectedClientId || sending) return;
    setSending(true);
    const content = text.trim();
    setText('');
    const { data: inserted, error } = await supabase.from('pt_messages').insert({
      client_id: selectedClientId,
      sender: 'pt',
      content,
    }).select('*').single();
    if (error) {
      setText(content);
      setSending(false);
      return;
    }
    if (inserted) mergeMessages([inserted as Message]);
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

  const formatDay = (iso: string) =>
    new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

  let lastDay = '';

  return (
    <div className="flex h-[calc(100dvh-10rem)] min-h-[32rem] flex-col overflow-hidden lg:h-[calc(100vh-1.5rem)] lg:flex-row">
      <aside className="flex max-h-52 w-full shrink-0 flex-col border-b border-black/8 bg-white lg:max-h-none lg:w-64 lg:border-b-0 lg:border-r">
        <div className="px-5 py-4 border-b border-black/8 lg:py-5">
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-1">PT</p>
          <h1 className="font-display text-xl font-light">Messages</h1>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {clients.length === 0 ? (
            <p className="px-5 py-4 text-xs text-black/30">No clients yet.</p>
          ) : (
            clients.map((c) => {
              const last = lastMessageByClient[c.id];
              const count = unread[c.id] ?? 0;
              const active = c.id === selectedClientId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedClientId(c.id)}
                  className={`w-full text-left px-4 py-4 border-b border-black/5 transition-colors ${
                    active ? 'bg-black text-white' : 'hover:bg-black/4'
                  }`}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <p className={`text-sm font-medium truncate ${active ? 'text-white' : ''}`}>
                      {c.name}
                    </p>
                    {count > 0 && (
                      <span className="ml-2 shrink-0 text-[0.6rem] bg-black text-white rounded-full w-4 h-4 flex items-center justify-center font-medium">
                        {count}
                      </span>
                    )}
                  </div>
                  {last && (
                    <p className={`text-xs truncate mt-0.5 ${active ? 'text-white/60' : 'text-black/35'}`}>
                      {last.sender === 'pt' ? 'You: ' : ''}{last.content}
                    </p>
                  )}
                </button>
              );
            })
          )}
        </div>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col bg-[#fafaf8]">
        {!selectedClient ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-black/30">Select a client to start chatting.</p>
          </div>
        ) : (
          <>
            <div className="shrink-0 border-b border-black/8 bg-white px-4 py-4 sm:px-6">
              <p className="font-medium text-sm">{selectedClient.name}</p>
              <p className="text-xs text-black/40">{selectedClient.email}</p>
            </div>

            <div ref={messagesRef} className="flex-1 space-y-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
              {loading ? (
                <p className="text-xs text-black/30 text-center py-8">Loading messages...</p>
              ) : messages.length === 0 ? (
                <p className="text-xs text-black/30 text-center py-8">
                  No messages yet. Say hello.
                </p>
              ) : (
                messages.map((m) => {
                  const day = formatDay(m.created_at);
                  const showDay = day !== lastDay;
                  lastDay = day;
                  const isPT = m.sender === 'pt';
                  return (
                    <div key={m.id}>
                      {showDay && (
                        <div className="flex items-center gap-3 my-4">
                          <div className="flex-1 h-px bg-black/8" />
                          <span className="text-[0.6rem] uppercase tracking-[0.15em] text-black/25">{day}</span>
                          <div className="flex-1 h-px bg-black/8" />
                        </div>
                      )}
                      <div className={`flex ${isPT ? 'justify-end' : 'justify-start'} mb-1`}>
                        <div className={`max-w-[86%] sm:max-w-[70%] ${isPT ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
                          {m.context?.day_title && (
                            <span className={`text-[0.6rem] uppercase tracking-[0.12em] px-2 py-0.5 rounded ${
                              isPT ? 'text-black/30 self-end' : 'bg-black/6 text-black/40 self-start'
                            }`}>
                              {m.context.phase_title && `${m.context.phase_title} · `}{m.context.day_title}
                            </span>
                          )}
                          <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                            isPT
                              ? 'bg-black text-white rounded-br-sm'
                              : 'bg-white border border-black/10 text-black rounded-bl-sm'
                          }`}>
                            {m.content}
                          </div>
                          <span className="text-[0.6rem] text-black/25 px-1">{formatTime(m.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={bottomRef} />
            </div>

            <div className="flex shrink-0 items-end gap-2 border-t border-black/8 bg-white px-3 py-3 sm:px-4">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKey}
                placeholder={`Message ${selectedClient.name}…`}
                rows={1}
                style={{ fontSize: '16px' }}
                className="flex-1 resize-none border border-black/10 px-4 py-3 outline-none focus:border-black/30 rounded-xl leading-snug"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={!text.trim() || sending}
                className="shrink-0 border border-black bg-black text-white px-4 py-3 text-sm rounded-xl disabled:opacity-30 hover:bg-white hover:text-black transition-colors"
              >
                Send
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
