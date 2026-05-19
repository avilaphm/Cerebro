'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

// Speech recognition types
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
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface PhotoEntry {
  preview: string;
  base64: string;
  mimeType: string;
}

interface Props {
  clientId: string;
  onClose: () => void;
  onLogged: () => void;
}

export default function NutritionChatModal({ clientId, onClose, onLogged }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [recording, setRecording] = useState(false);
  const [logging, setLogging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loggedCount, setLoggedCount] = useState<number | null>(null);

  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const interimRef = useRef('');
  const finalTextRef = useRef('');
  const sessionFinalRef = useRef(''); // finals accumulated in the current recording session

  // Lock background scroll
  useEffect(() => {
    const scrollEl = document.querySelector<HTMLElement>('.client-liquid > div');
    if (!scrollEl) return;
    const prev = scrollEl.style.overflowY;
    scrollEl.style.overflowY = 'hidden';
    return () => { scrollEl.style.overflowY = prev; };
  }, []);

  useEffect(() => () => { recognitionRef.current?.abort(); }, []);

  useEffect(() => {
    if (!logging) { setProgress(0); return; }
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.min(95, Math.round(95 * (1 - Math.exp(-elapsed / 5000)))));
    }, 150);
    return () => clearInterval(id);
  }, [logging]);

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
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      sessionFinalRef.current = final;
      interimRef.current = interim;
      const base = finalTextRef.current;
      const parts = [base, final, interim].filter((s) => s.trim());
      setText(parts.join(' '));
    };

    rec.onend = () => {
      setRecording(false);
      // Commit base text + all finals from this session (drop trailing interim)
      const base = finalTextRef.current;
      const committed = [base, sessionFinalRef.current].filter((s) => s.trim()).join(' ').trim();
      finalTextRef.current = committed;
      setText(committed);
      interimRef.current = '';
      sessionFinalRef.current = '';
    };

    rec.onerror = () => {
      setRecording(false);
      // Keep whatever finals were captured before the error
      const base = finalTextRef.current;
      const committed = [base, sessionFinalRef.current].filter((s) => s.trim()).join(' ').trim();
      finalTextRef.current = committed;
      setText(committed);
      interimRef.current = '';
      sessionFinalRef.current = '';
    };

    rec.start();
    recognitionRef.current = rec;
    finalTextRef.current = text;
    sessionFinalRef.current = '';
    setRecording(true);
  };

  const stopVoice = () => { recognitionRef.current?.stop(); };

  const toBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const addPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = 10 - photos.length;
    if (remaining <= 0) return;

    const toAdd = Array.from(files).slice(0, remaining);
    const entries = await Promise.all(
      toAdd.map(async (file) => {
        const base64 = await toBase64(file);
        const preview = URL.createObjectURL(file);
        return { preview, base64, mimeType: file.type };
      }),
    );
    setPhotos((prev) => [...prev, ...entries]);
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => {
      const next = [...prev];
      URL.revokeObjectURL(next[index].preview);
      next.splice(index, 1);
      return next;
    });
  };

  const handleLog = async () => {
    const hasContent = text.trim() || photos.length > 0;
    if (!hasContent || logging) return;
    if (recording) stopVoice();
    setLogging(true);
    setError(null);

    try {
      const { data, error: fnErr } = await supabase.functions.invoke<{ ok: boolean; count: number; error?: string }>(
        'log-nutrition-batch',
        {
          body: {
            client_id: clientId,
            text: text.trim() || undefined,
            photos: photos.map((p) => ({ base64: p.base64, mime_type: p.mimeType })),
            current_time: new Date().toISOString(),
          },
        },
      );

      if (fnErr || !data?.ok) {
        setError(data?.error ?? "Couldn't log food. Try describing what you ate more clearly.");
        return;
      }

      setLoggedCount(data.count);
      setTimeout(() => {
        onLogged();
        onClose();
      }, 900);
    } finally {
      setLogging(false);
    }
  };

  const hasContent = text.trim() || photos.length > 0;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#f2f2f0]">
      {/* Header */}
      <div className="flex shrink-0 items-center px-4 pb-3 pt-14">
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/8 bg-white text-black/40 shadow-sm transition-colors hover:text-black"
          aria-label="Close"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 2l10 10M12 2L2 12" />
          </svg>
        </button>

        <div className="flex-1 px-3 text-center">
          <p className="text-sm font-medium leading-tight">Log Your Food</p>
          <p className="mt-0.5 text-[0.6rem] leading-tight text-black/35">
            Voice dump, add photos, or type what you ate
          </p>
        </div>

        <div className="h-9 w-9 shrink-0" />
      </div>

      {/* Photo tip banner */}
      <div className="mx-4 mb-1 flex shrink-0 items-start gap-2.5 rounded-2xl border border-black/8 bg-white px-3.5 py-3 shadow-sm">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="mt-0.5 shrink-0 text-black/35">
          <path d="M1.5 5h2l1.5-2h6L12.5 5H14.5v8.5h-13V5z" />
          <circle cx="8" cy="9" r="2.2" />
        </svg>
        <p className="text-[0.65rem] leading-relaxed text-black/45">
          <span className="font-medium text-black/60">Better photo results:</span> separate ingredients on the plate so each item is visible. Food stacked on top of other food hides depth — the AI can&apos;t judge portion size accurately when items overlap.
        </p>
      </div>

      {/* Main content area */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2">
        {loggedCount !== null ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black text-white">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 11l5 5L18 6" />
              </svg>
            </div>
            <p className="text-sm font-medium">{loggedCount} meal{loggedCount !== 1 ? 's' : ''} logged</p>
          </div>
        ) : logging ? (
          <div className="flex flex-col items-center justify-center py-16 gap-6">
            <div className="relative h-16 w-16">
              <svg className="absolute inset-0 -rotate-90" width="64" height="64" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="3" className="text-black/10" />
                <circle
                  cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="3"
                  strokeLinecap="round"
                  className="text-black"
                  style={{
                    strokeDasharray: `${2 * Math.PI * 28}`,
                    strokeDashoffset: `${2 * Math.PI * 28 * (1 - progress / 100)}`,
                    transition: 'stroke-dashoffset 0.3s ease-out',
                  }}
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">{progress}%</span>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">
                {progress < 25 ? 'Reading your food…' : progress < 55 ? 'Identifying meals…' : progress < 80 ? 'Calculating nutrition…' : 'Saving to your log…'}
              </p>
              <p className="mt-1 text-[0.65rem] text-black/35">This usually takes a few seconds</p>
            </div>
          </div>
        ) : !hasContent ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
            <p className="text-sm text-black/35 leading-relaxed max-w-[16rem]">
              Tap the mic and brain dump what you ate today — or add photos, or type it out.
            </p>
            <p className="text-[0.65rem] text-black/25">The AI will split it into meals automatically.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {text.trim() && (
              <div className={`rounded-[1.2rem] bg-white px-4 py-3 shadow-sm ${recording ? 'border border-red-200' : ''}`}>
                <p className="text-sm leading-relaxed text-black">
                  {text}
                  {recording && interimRef.current && (
                    <span className="text-black/35"> {interimRef.current}</span>
                  )}
                </p>
                {recording && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                    <span className="text-[0.6rem] text-red-400 uppercase tracking-[0.1em]">Listening</span>
                  </div>
                )}
              </div>
            )}

            {photos.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {photos.map((p, i) => (
                  <div key={i} className="relative shrink-0">
                    <img src={p.preview} alt={`food ${i + 1}`} className="h-24 w-24 rounded-2xl object-cover shadow-sm" />
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black text-white text-[0.6rem] shadow"
                      aria-label="Remove photo"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {photos.length < 10 && (
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl border-2 border-dashed border-black/15 text-black/30 hover:border-black/25 hover:text-black/40 transition-colors"
                  >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M10 4v12M4 10h12" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input card */}
      {loggedCount === null && !logging && (
        <div className="shrink-0 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-2">
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => void addPhotos(e.target.files)}
            className="hidden"
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => void addPhotos(e.target.files)}
            className="hidden"
          />

          {error && (
            <p className="pb-2 pl-1 text-[0.65rem] text-red-500">{error}</p>
          )}

          <div className="overflow-hidden rounded-[1.4rem] border border-black/8 bg-white shadow-sm">
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                finalTextRef.current = e.target.value;
              }}
              placeholder={recording ? 'Listening…' : 'Or type here — e.g. "had eggs for breakfast, sandwich for lunch"'}
              rows={2}
              className={`w-full resize-none bg-transparent px-4 pb-2 pt-3.5 text-sm leading-relaxed outline-none transition-colors placeholder:text-black/25 ${
                recording ? 'text-red-700' : ''
              }`}
              style={{ maxHeight: '6rem' }}
            />

            <div className="flex items-center gap-2 px-2 pb-3.5 pt-1">
              {/* Gallery — multiple photos from camera roll */}
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                disabled={photos.length >= 10 || logging}
                className="flex h-11 w-11 items-center justify-center rounded-full text-black/40 transition-colors hover:bg-black/5 hover:text-black disabled:opacity-30"
                aria-label="Add photos from library"
              >
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M11 4v14M4 11h14" />
                </svg>
              </button>

              {/* Camera — direct capture */}
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={photos.length >= 10 || logging}
                className="flex h-11 w-11 items-center justify-center rounded-full text-black/40 transition-colors hover:bg-black/5 hover:text-black disabled:opacity-30"
                aria-label="Take a photo"
              >
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M2 7h3l2-2.5h9L18 7h2v11.5H2V7z" />
                  <circle cx="11" cy="13" r="3" />
                </svg>
              </button>

              {photos.length > 0 && (
                <span className="text-[0.6rem] text-black/30 tabular-nums">{photos.length}/10</span>
              )}

              <div className="flex-1" />

              {/* Mic */}
              <button
                type="button"
                onClick={recording ? stopVoice : startVoice}
                disabled={logging}
                className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors disabled:opacity-30 ${
                  recording ? 'bg-red-50 text-red-500' : 'text-black/40 hover:bg-black/5 hover:text-black'
                }`}
                aria-label={recording ? 'Stop recording' : 'Start voice input'}
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

              {/* Log food button */}
              <button
                type="button"
                onClick={() => void handleLog()}
                disabled={!hasContent || logging}
                className="ml-1 flex h-11 items-center gap-2 rounded-full bg-black px-5 text-sm font-medium text-white transition-opacity disabled:opacity-20"
                aria-label="Log food"
              >
                {logging ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                ) : (
                  <>
                    Log food
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M7 12V2M2 7l5-5 5 5" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
