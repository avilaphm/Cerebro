'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

// Local Web Speech API types
interface SpeechRecognitionResultItemLike { transcript: string; }
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionResultItemLike;
}
interface SpeechRecognitionEventLike extends Event {
  results: ArrayLike<SpeechRecognitionResultLike>;
  resultIndex: number;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface Message {
  id: string;
  sender: 'pt' | 'client' | 'ai';
  content: string;
  created_at: string;
  ai_handoff_requested?: boolean;
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

interface NutritionLog {
  meal_description: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fibre_g: number | null;
}

export default function MessageBubble({ clientId, workoutContext }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [aiThinking, setAiThinking] = useState(false);
  const [unread, setUnread] = useState(0);

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const interimRef = useRef('');

  // Lock background scroll when chat is open
  useEffect(() => {
    if (!open) return;
    const scrollEl = document.querySelector<HTMLElement>('.client-liquid > div');
    if (!scrollEl) return;
    const prev = scrollEl.style.overflowY;
    scrollEl.style.overflowY = 'hidden';
    return () => { scrollEl.style.overflowY = prev; };
  }, [open]);

  // iOS: non-passive touchmove on the overlay blocks scroll pass-through
  // to the background page when touching non-scrollable areas of the chat.
  useEffect(() => {
    if (!open) return;
    const el = overlayRef.current;
    if (!el) return;
    const prevent = (e: TouchEvent) => {
      if (messagesRef.current?.contains(e.target as Node)) return;
      e.preventDefault();
    };
    el.addEventListener('touchmove', prevent, { passive: false });
    return () => el.removeEventListener('touchmove', prevent);
  }, [open]);

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
      .select('id, sender, content, created_at, context, ai_handoff_requested')
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
      .in('sender', ['pt', 'ai'])
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
          if ((msg.sender === 'pt' || msg.sender === 'ai') && !open) {
            setUnread((n) => n + 1);
          }
          if (msg.sender === 'ai') {
            setAiThinking(false);
          }
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [clientId, mergeMessages, open, supabase]);

  useEffect(() => () => { recognitionRef.current?.abort(); }, []);

  const startVoice = () => {
    const SpeechRecog = getSpeechRecognition();
    if (!SpeechRecog) return;

    const rec = new SpeechRecog();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-AU';

    rec.onresult = (e: SpeechRecognitionEventLike) => {
      let final = '';
      let interim = '';
      const len = e.results.length;
      for (let i = 0; i < len; i++) {
        const r = e.results[i];
        const transcript = r[0].transcript;
        if (r.isFinal) final += transcript;
        else interim += transcript;
      }
      interimRef.current = interim;
      setText(final + interim);
    };

    rec.onend = () => {
      setRecording(false);
      setText((t) => t.replace(interimRef.current, '').trim());
      interimRef.current = '';
    };

    rec.onerror = () => {
      setRecording(false);
      interimRef.current = '';
    };

    rec.start();
    recognitionRef.current = rec;
    setRecording(true);
  };

  const stopVoice = () => {
    recognitionRef.current?.stop();
  };

  const toBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const dispatchAIChat = (messageId: string, content: string) => {
    setAiThinking(true);
    void supabase.functions.invoke('ai-client-chat', {
      body: { client_id: clientId, message_id: messageId, content },
    }).then(() => {
      void loadMessages();
      setAiThinking(false);
    }).catch(() => setAiThinking(false));
  };

  const logPhotoFood = async (file: File) => {
    setSending(true);
    setLogError(null);
    try {
      const base64 = await toBase64(file);
      const { data, error } = await supabase.functions.invoke<{ ok: boolean; nutrition: NutritionLog }>('log-nutrition', {
        body: {
          client_id: clientId,
          input_type: 'photo',
          content: '',
          file_base64: base64,
          file_mime_type: file.type,
        },
      });

      if (error || !data?.ok || !data.nutrition) {
        setLogError("Couldn't read that photo — try again or type what you ate.");
        return;
      }

      const n = data.nutrition;
      const parts: string[] = [`Logged: ${n.meal_description}`];
      if (n.calories) parts.push(`${n.calories} kcal`);
      const macros = [
        n.protein_g != null ? `${n.protein_g}g P` : null,
        n.carbs_g != null ? `${n.carbs_g}g C` : null,
        n.fat_g != null ? `${n.fat_g}g F` : null,
        n.fibre_g != null ? `${n.fibre_g}g fibre` : null,
      ].filter(Boolean).join(' · ');
      if (macros) parts.push(macros);
      const content = parts.join(' · ');

      const { data: inserted, error: msgErr } = await supabase
        .from('pt_messages')
        .insert({ client_id: clientId, sender: 'client', content, context: workoutContext ?? null })
        .select('id, sender, content, created_at, context')
        .single();

      if (msgErr || !inserted) return;

      const msg = inserted as Message;
      mergeMessages([msg]);

      void supabase.functions.invoke('extract-client-note', {
        body: { message_id: msg.id, client_id: clientId, content, context: workoutContext },
      });

      dispatchAIChat(msg.id, content);
    } finally {
      setPhotoFile(null);
      setPhotoPreview(null);
      setSending(false);
    }
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setLogError(null);
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const send = async () => {
    if (!text.trim() || sending) return;
    if (recording) stopVoice();
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

      dispatchAIChat(message.id, content);
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
      {/* Floating chat button — hidden on mobile when panel is open (panel has its own close) */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`fixed right-4 top-4 z-[51] flex h-12 w-12 items-center justify-center rounded-full bg-black text-white shadow-[0_18px_40px_-22px_rgba(0,0,0,0.8)] transition-transform hover:scale-105 md:right-6 md:top-6 ${open ? 'hidden sm:flex' : ''}`}
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
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[0.6rem] font-bold text-white">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div ref={overlayRef} className="fixed inset-0 z-50 flex flex-col bg-[#f2f2f0] sm:inset-auto sm:right-6 sm:top-24 sm:max-h-[calc(100dvh-8rem)] sm:w-96 sm:overflow-hidden sm:rounded-3xl sm:border sm:border-black/10 sm:shadow-2xl">

          {/* Header */}
          <div className="flex shrink-0 items-center px-4 pb-3 pt-14 sm:pt-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/8 bg-white text-black/40 shadow-sm transition-colors hover:text-black sm:hidden"
              aria-label="Close chat"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 2l10 10M12 2L2 12" />
              </svg>
            </button>

            <div className="flex-1 px-3 text-center sm:px-0 sm:text-left">
              <p className="text-sm font-medium leading-tight">AI Coach</p>
              <p className="mt-0.5 text-[0.6rem] leading-tight text-black/35">
                {workoutContext
                  ? `${workoutContext.phase_title} · ${workoutContext.day_title}`
                  : 'Say "hey Pedro" to reach your coach'}
              </p>
            </div>

            {/* Spacer to balance the close button on mobile */}
            <div className="h-9 w-9 shrink-0 sm:hidden" />
          </div>

          {/* Messages */}
          <div ref={messagesRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-2">
            {messages.length === 0 ? (
              <p className="py-10 text-center text-xs text-black/30">
                Ask anything about your programme, exercises, or nutrition.
              </p>
            ) : (
              messages.map((m) => {
                const isClient = m.sender === 'client';
                const isAI = m.sender === 'ai';
                return (
                  <div key={m.id} className={`mb-2 flex ${isClient ? 'justify-end' : 'justify-start'}`}>
                    <div className={`flex max-w-[82%] flex-col gap-0.5 ${isClient ? 'items-end' : 'items-start'}`}>
                      {m.context?.day_title && isClient && (
                        <span className="text-[0.55rem] uppercase tracking-[0.12em] text-black/30">
                          {m.context.phase_title && `${m.context.phase_title} · `}{m.context.day_title}
                        </span>
                      )}
                      {isAI && (
                        <span className="px-1 text-[0.55rem] uppercase tracking-[0.12em] text-black/35">AI Coach</span>
                      )}
                      <div className={`px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ${
                        isClient
                          ? 'rounded-[1.2rem] rounded-br-sm bg-black text-white'
                          : 'rounded-[1.2rem] rounded-bl-sm bg-white text-black'
                      }`}>
                        {m.content}
                      </div>
                      {m.ai_handoff_requested && (
                        <span className="px-1 text-[0.55rem] text-amber-600">Pedro notified</span>
                      )}
                      <span className="px-1 text-[0.55rem] text-black/25">{formatTime(m.created_at)}</span>
                    </div>
                  </div>
                );
              })
            )}
            {aiThinking && (
              <div className="mb-2 flex justify-start">
                <div className="flex max-w-[82%] flex-col gap-0.5 items-start">
                  <span className="px-1 text-[0.55rem] uppercase tracking-[0.12em] text-black/35">AI Coach</span>
                  <div className="rounded-[1.2rem] rounded-bl-sm bg-white px-3.5 py-2.5 text-sm text-black/40 shadow-sm">
                    Thinking...
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input area — Claude-style card */}
          <div className="shrink-0 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-2">
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoSelect}
              className="hidden"
            />

            {logError && (
              <p className="pb-2 pl-1 text-[0.65rem] text-red-500">{logError}</p>
            )}

            {photoPreview && (
              <div className="mb-2 flex items-center gap-3 rounded-2xl bg-white px-3 py-2 shadow-sm">
                <img src={photoPreview} alt="food" className="h-12 w-12 flex-none rounded-xl object-cover" />
                <p className="flex-1 text-xs text-black/50">Ready to log</p>
                <button
                  type="button"
                  onClick={() => { setPhotoFile(null); setPhotoPreview(null); setLogError(null); }}
                  className="text-[0.7rem] text-black/30 hover:text-black"
                >
                  cancel
                </button>
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => photoFile && void logPhotoFood(photoFile)}
                  className="rounded-xl bg-black px-3 py-1.5 text-xs text-white disabled:opacity-30"
                >
                  {sending ? '…' : 'Log food'}
                </button>
              </div>
            )}

            <div className="overflow-hidden rounded-[1.4rem] border border-black/8 bg-white shadow-sm">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKey}
                placeholder={recording ? 'Listening…' : 'Message AI Coach…'}
                rows={1}
                className={`w-full resize-none bg-transparent px-4 pb-2 pt-3.5 text-sm leading-relaxed outline-none transition-colors placeholder:text-black/30 ${
                  recording ? 'text-red-700 placeholder:text-red-300' : ''
                }`}
                style={{ maxHeight: '7rem' }}
              />
              <div className="flex items-center gap-2 px-2 pb-3.5 pt-1">
                {/* + / Camera */}
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={sending}
                  className="flex h-11 w-11 items-center justify-center rounded-full text-black/40 transition-colors hover:bg-black/5 hover:text-black disabled:opacity-30"
                  aria-label="Log food photo"
                >
                  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M11 4v14M4 11h14" />
                  </svg>
                </button>

                <div className="flex-1" />

                {/* Mic — toggles voice transcription */}
                <button
                  type="button"
                  onClick={recording ? stopVoice : startVoice}
                  disabled={sending}
                  className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors disabled:opacity-30 ${
                    recording ? 'bg-red-50 text-red-500' : 'text-black/40 hover:bg-black/5 hover:text-black'
                  }`}
                  aria-label={recording ? 'Stop recording' : 'Voice input'}
                >
                  {recording ? (
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                      <rect x="5" y="5" width="10" height="10" rx="2" />
                    </svg>
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <rect x="7.5" y="1.5" width="7" height="11" rx="3.5" />
                      <path d="M3.5 11a7.5 7.5 0 0015 0M11 18.5v2" />
                    </svg>
                  )}
                </button>

                {/* Send — dark circle */}
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={!text.trim() || sending}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-black text-white transition-opacity disabled:opacity-20"
                  aria-label="Send message"
                >
                  {sending ? (
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 15V3M3 9l6-6 6 6" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
