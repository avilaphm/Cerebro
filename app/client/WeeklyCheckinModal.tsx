'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface LocalSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface LocalWindow extends Window {
  SpeechRecognition?: new () => LocalSpeechRecognition;
  webkitSpeechRecognition?: new () => LocalSpeechRecognition;
}
import { X, Mic, Send, Camera, ChevronRight } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import type { CheckinWeeklyFocus, PTSlotSuggestion } from '@/utils/pt/types';

interface CheckinMessage {
  role: 'user' | 'assistant';
  content: string;
  ui_hint?: string;
  created_at: string;
}

interface ActivitySelection {
  activity: string;
  suggested_date: string;
  suggested_time: string;
  confirmed: boolean;
}

interface CheckinResponse {
  session_id: string;
  ai_message: string;
  ui_hint: 'none' | 'calendar_upload' | 'pt_slot_select' | 'activity_select' | 'checkin_complete';
  payload?: {
    slots?: PTSlotSuggestion[];
    activities?: string[];
    focus?: CheckinWeeklyFocus;
    activity_selections?: ActivitySelection[];
  };
}

interface Props {
  clientId: string;
  clientName: string;
  onClose: () => void;
  onComplete: (focus: CheckinWeeklyFocus) => void;
}

const ACTIVITY_OPTIONS = ['Golf', 'Run', 'Pilates', 'Walk', 'Classes'];

export default function WeeklyCheckinModal({ clientId, clientName, onClose, onComplete }: Props) {
  const supabase = createClient();
  const [messages, setMessages] = useState<CheckinMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [currentUiHint, setCurrentUiHint] = useState<string>('none');
  const [ptSlots, setPtSlots] = useState<PTSlotSuggestion[]>([]);
  const [activities, setActivities] = useState<string[]>([]);
  const [selectedActivities, setSelectedActivities] = useState<string[]>([]);
  const [pendingImage, setPendingImage] = useState<{base64: string; mimeType: string} | null>(null);
  const [recording, setRecording] = useState(false);
  const [slotBooked, setSlotBooked] = useState(false);
  const [bookingInProgress, setBookingInProgress] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<LocalSpeechRecognition | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const sendMessage = useCallback(async (text: string, imageBase64?: string, imageMime?: string) => {
    if (loading) return;
    setLoading(true);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }

    const userMsg: CheckinMessage = {
      role: 'user',
      content: imageBase64 ? (text ? text : '[Calendar screenshot]') : text,
      created_at: new Date().toISOString(),
    };

    if (text || imageBase64) {
      setMessages((prev) => [...prev, userMsg]);
    }
    setInputText('');
    setPendingImage(null);

    try {
      const body: Record<string, unknown> = {
        client_id: clientId,
        session_id: sessionId,
        user_message: text || (imageBase64 ? 'Here is my calendar screenshot.' : 'Start the check-in.'),
      };

      if (imageBase64 && imageMime) {
        body.image_base64 = imageBase64;
        body.image_mime_type = imageMime;
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/client-ai-checkin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });

      const data = (await response.json()) as CheckinResponse;

      if (!response.ok) {
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: 'Something went wrong. Please try again.',
          created_at: new Date().toISOString(),
        }]);
        setLoading(false);
        return;
      }

      setSessionId(data.session_id);
      setCurrentUiHint(data.ui_hint);

      const aiMsg: CheckinMessage = {
        role: 'assistant',
        content: data.ai_message,
        ui_hint: data.ui_hint !== 'none' ? data.ui_hint : undefined,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, aiMsg]);

      if (data.ui_hint === 'pt_slot_select' && data.payload?.slots) {
        setPtSlots(data.payload.slots);
      }

      if (data.ui_hint === 'activity_select') {
        setActivities(data.payload?.activities ?? ACTIVITY_OPTIONS);
      }

      if (data.ui_hint === 'checkin_complete' && data.payload?.focus) {
        onComplete(data.payload.focus);
      }
    } catch {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: 'Something went wrong. Please try again.',
        created_at: new Date().toISOString(),
      }]);
    }

    setLoading(false);
  }, [clientId, sessionId, loading, supabase, onComplete]);

  useEffect(() => {
    if (!started) {
      setStarted(true);
      void sendMessage('');
    }
  }, [started, sendMessage]);

  const handleSend = () => {
    const text = inputText.trim();
    if (!text && !pendingImage) return;
    void sendMessage(text, pendingImage?.base64, pendingImage?.mimeType);
  };

  const handleImageUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      const base64 = result.split(',')[1];
      setPendingImage({ base64, mimeType: file.type });
    };
    reader.readAsDataURL(file);
  };

  const handleBookSlot = async (slot: PTSlotSuggestion) => {
    setBookingInProgress(true);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setBookingInProgress(false); return; }

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/manage-pt-booking`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: 'create', client_id: clientId, start_at: slot.start_at }),
      });

      if (response.ok) {
        setSlotBooked(true);
        setPtSlots([]);
        setCurrentUiHint('none');
        await sendMessage(`I booked the ${slot.label} session with Pedro.`);
      } else {
        await sendMessage(`I tried to book ${slot.label} but it wasn't available. Can we continue without booking for now?`);
      }
    } catch {
      await sendMessage('I had trouble booking that slot. Let\'s continue and I\'ll book it separately.');
    }

    setBookingInProgress(false);
  };

  const handleSkipBooking = async () => {
    setCurrentUiHint('none');
    setPtSlots([]);
    await sendMessage('I\'ll sort the PT session booking separately. Let\'s continue.');
  };

  const handleActivitiesConfirm = async () => {
    if (selectedActivities.length === 0) {
      await sendMessage('I\'d like to skip extra activities this week.');
      return;
    }
    setCurrentUiHint('none');
    await sendMessage(`I want to do: ${selectedActivities.join(', ')}.`);
  };

  const toggleVoice = () => {
    const w = window as LocalWindow;
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) return;

    if (recording) {
      recognitionRef.current?.stop();
      setRecording(false);
      return;
    }

    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-AU';

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? '';
      setInputText((prev) => (prev ? `${prev} ${transcript}` : transcript).trim());
    };

    recognition.onend = () => setRecording(false);
    recognition.onerror = () => setRecording(false);
    recognition.start();
    recognitionRef.current = recognition;
    setRecording(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white md:items-center md:justify-center md:bg-black/40">
      <div className="flex h-full w-full flex-col overflow-hidden bg-white md:h-[90vh] md:max-h-[720px] md:w-full md:max-w-2xl md:rounded-lg md:shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-black/10 px-4 py-3.5">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">AI Check-in</p>
            <p className="mt-0.5 text-sm font-medium">{clientName}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-black/40 hover:text-black">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.map((msg, index) => (
            <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[82%] px-3.5 py-2.5 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-black text-white'
                  : 'bg-[#f5f5f2] text-black'
              }`}>
                {msg.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-[#f5f5f2] px-4 py-3">
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-black/30" style={{ animationDelay: '0ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-black/30" style={{ animationDelay: '150ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-black/30" style={{ animationDelay: '300ms' }} />
                </span>
              </div>
            </div>
          )}

          {currentUiHint === 'calendar_upload' && !loading && (
            <div className="flex justify-start">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 border border-black/15 bg-white px-4 py-2.5 text-sm text-black/70 hover:border-black hover:text-black"
              >
                <Camera className="h-4 w-4" />
                Upload calendar screenshot
              </button>
            </div>
          )}

          {currentUiHint === 'pt_slot_select' && ptSlots.length > 0 && !loading && (
            <div className="space-y-2">
              {ptSlots.slice(0, 4).map((slot, i) => (
                <div key={i} className="flex justify-start">
                  <button
                    type="button"
                    disabled={bookingInProgress}
                    onClick={() => void handleBookSlot(slot)}
                    className="flex w-full max-w-xs items-center justify-between border border-black/15 bg-white px-4 py-2.5 text-sm hover:border-black disabled:opacity-50"
                  >
                    <span>{slot.label}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-black/35" />
                  </button>
                </div>
              ))}
              <div className="flex justify-start">
                <button
                  type="button"
                  onClick={() => void handleSkipBooking()}
                  className="text-xs text-black/40 underline-offset-2 hover:text-black hover:underline"
                >
                  Skip - I'll book separately
                </button>
              </div>
            </div>
          )}

          {currentUiHint === 'activity_select' && !loading && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {activities.map((activity) => (
                  <button
                    key={activity}
                    type="button"
                    onClick={() => setSelectedActivities((prev) =>
                      prev.includes(activity) ? prev.filter((a) => a !== activity) : [...prev, activity]
                    )}
                    className={`border px-3.5 py-2 text-sm transition-colors ${
                      selectedActivities.includes(activity)
                        ? 'border-black bg-black text-white'
                        : 'border-black/15 bg-white text-black hover:border-black'
                    }`}
                  >
                    {activity}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void handleActivitiesConfirm()}
                className="border border-black bg-black px-4 py-2 text-sm text-white hover:bg-black/80"
              >
                {selectedActivities.length > 0 ? `Confirm ${selectedActivities.length} activit${selectedActivities.length === 1 ? 'y' : 'ies'}` : 'Skip activities'}
              </button>
            </div>
          )}

          {pendingImage && (
            <div className="flex justify-end">
              <div className="border border-black/10 bg-[#f5f5f2] px-3 py-2 text-xs text-black/50">
                Calendar screenshot ready to send
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="shrink-0 border-t border-black/10 p-3">
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 p-2 text-black/35 hover:text-black"
              title="Upload calendar"
            >
              <Camera className="h-4 w-4" />
            </button>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={1}
              placeholder="Type or speak your response..."
              className="flex-1 resize-none border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/35"
              style={{ minHeight: '36px', maxHeight: '100px' }}
            />
            <button
              type="button"
              onClick={toggleVoice}
              className={`shrink-0 p-2 transition-colors ${recording ? 'text-red-600' : 'text-black/35 hover:text-black'}`}
              title={recording ? 'Stop recording' : 'Speak'}
            >
              <Mic className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={loading || (!inputText.trim() && !pendingImage)}
              className="shrink-0 bg-black p-2 text-white disabled:opacity-40 hover:bg-black/80"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImageUpload(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
