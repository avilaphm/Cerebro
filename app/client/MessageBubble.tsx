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
  const photoInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const interimRef = useRef('');

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

  // Clean up speech recognition on unmount
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
      // Keep only the final text (no interim suffix)
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
    // onend will fire and clean up state
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
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed right-4 top-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-black text-white shadow-[0_18px_40px_-22px_rgba(0,0,0,0.8)] transition-transform hover:scale-105 md:right-6 md:top-6"
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
        <div className="fixed inset-x-3 top-20 z-50 flex max-h-[calc(100dvh-6rem)] flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl sm:inset-auto sm:right-6 sm:top-24 sm:h-auto sm:max-h-[70vh] sm:w-96">
          <div className="px-4 py-3 border-b border-black/8 flex items-center justify-between shrink-0">
            <div>
              <p className="text-sm font-medium">AI Coach</p>
              <p className="text-[0.6rem] text-black/35 mt-0.5">
                {workoutContext
                  ? `${workoutContext.phase_title} · ${workoutContext.day_title}`
                  : 'Say "hey Pedro" to reach your coach directly'}
              </p>
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
                Ask anything about your programme, exercises, or nutrition. Say &quot;hey Pedro&quot; to reach your coach directly.
              </p>
            ) : (
              messages.map((m) => {
                const isClient = m.sender === 'client';
                const isAI = m.sender === 'ai';
                return (
                  <div key={m.id} className={`flex ${isClient ? 'justify-end' : 'justify-start'} mb-1`}>
                    <div className={`max-w-[85%] flex flex-col gap-0.5 ${isClient ? 'items-end' : 'items-start'}`}>
                      {m.context?.day_title && isClient && (
                        <span className="text-[0.55rem] uppercase tracking-[0.12em] text-black/30">
                          {m.context.phase_title && `${m.context.phase_title} · `}{m.context.day_title}
                        </span>
                      )}
                      {isAI && (
                        <span className="text-[0.55rem] uppercase tracking-[0.12em] text-black/35 px-1">AI Coach</span>
                      )}
                      <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                        isClient
                          ? 'bg-black text-white rounded-br-sm'
                          : isAI
                            ? 'bg-[#eef4ff] text-black rounded-bl-sm border border-blue-100'
                            : 'bg-[#f0f0ec] text-black rounded-bl-sm'
                      }`}>
                        {m.content}
                      </div>
                      {m.ai_handoff_requested && (
                        <span className="text-[0.55rem] text-amber-600 px-1">Pedro notified</span>
                      )}
                      <span className="text-[0.55rem] text-black/25 px-1">{formatTime(m.created_at)}</span>
                    </div>
                  </div>
                );
              })
            )}
            {aiThinking && (
              <div className="flex justify-start mb-1">
                <div className="max-w-[85%] flex flex-col gap-0.5 items-start">
                  <span className="text-[0.55rem] uppercase tracking-[0.12em] text-black/35 px-1">AI Coach</span>
                  <div className="px-3 py-2 rounded-2xl rounded-bl-sm bg-[#eef4ff] border border-blue-100 text-sm text-black/40">
                    Thinking...
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="shrink-0 border-t border-black/8 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3">
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoSelect}
              className="hidden"
            />

            {logError && (
              <p className="px-3 pb-2 text-[0.65rem] text-red-500">{logError}</p>
            )}

            {/* Photo preview strip */}
            {photoPreview && (
              <div className="flex items-center gap-3 px-3 pb-2">
                <img src={photoPreview} alt="food" className="h-12 w-12 flex-none rounded-lg object-cover" />
                <p className="flex-1 text-xs text-black/50">Ready to log — tap &ldquo;Log food&rdquo;</p>
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
                  className="bg-black text-white px-3 py-1.5 text-xs rounded-xl disabled:opacity-30"
                >
                  {sending ? '…' : 'Log food'}
                </button>
              </div>
            )}

            {/* Main input row */}
            <div className="flex gap-2 px-3">
              {/* Camera */}
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={sending}
                className="flex-none text-black/25 hover:text-black transition-colors self-end pb-2 disabled:opacity-30"
                aria-label="Log food photo"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <path d="M1.5 5.5h2.5l1.5-2h7l1.5 2H16.5v9.5h-15V5.5z" />
                  <circle cx="9" cy="10.5" r="2.5" />
                </svg>
              </button>

              {/* Mic — click to start/stop live transcription */}
              <button
                type="button"
                onClick={recording ? stopVoice : startVoice}
                disabled={sending}
                className={`flex-none transition-colors self-end pb-2 disabled:opacity-30 ${recording ? 'text-red-500' : 'text-black/25 hover:text-black'}`}
                aria-label={recording ? 'Stop recording' : 'Start voice input'}
              >
                {recording ? (
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                  </span>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4">
                    <rect x="6" y="1" width="6" height="9" rx="3" />
                    <path d="M3 9a6 6 0 0012 0M9 15v2" />
                  </svg>
                )}
              </button>

              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKey}
                placeholder={recording ? 'Listening…' : 'Type a message…'}
                rows={1}
                className={`flex-1 resize-none border px-3 py-2 text-sm outline-none rounded-xl transition-colors ${
                  recording
                    ? 'border-red-200 bg-red-50/50 focus:border-red-300'
                    : 'border-black/10 focus:border-black/30'
                }`}
              />

              <button
                type="button"
                onClick={() => void send()}
                disabled={!text.trim() || sending}
                className="bg-black text-white px-3 py-2 text-sm rounded-xl disabled:opacity-30 self-end"
              >
                {sending ? '…' : '↑'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
