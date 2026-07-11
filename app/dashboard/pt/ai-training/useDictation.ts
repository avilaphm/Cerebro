'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

// Browser Web Speech API — same shape used in PTClientDetail.tsx. Chrome/Edge only;
// the mic button hides when unsupported. interimResults is ON so text streams in
// live as the coach speaks.
interface SpeechRecognitionResultItemLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionResultItemLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror?: ((e: { error?: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface DictationHandlers {
  onFinal: (text: string) => void;
  onInterim: (text: string) => void;
}

const noopSubscribe = () => () => {};

/**
 * One shared recogniser. `start(key)` begins dictation for a given question and
 * marks it as the active one; final phrases are committed via onFinal, the
 * in-progress phrase streams through onInterim. Starting a new key stops the old.
 */
export function useDictation(handlers: DictationHandlers) {
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => getSpeechRecognitionCtor() !== null,
    () => false,
  );
  const [listeningKey, setListeningKey] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const stop = useCallback(() => {
    const rec = recRef.current;
    recRef.current = null;
    setListeningKey(null);
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    }
  }, []);

  const start = useCallback((key: string) => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    if (recRef.current) {
      try {
        recRef.current.stop();
      } catch {
        /* ignore */
      }
      recRef.current = null;
    }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-AU';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) handlersRef.current.onFinal(text);
        else interim += text;
      }
      handlersRef.current.onInterim(interim);
    };
    rec.onerror = () => {
      if (recRef.current === rec) {
        recRef.current = null;
        setListeningKey(null);
      }
    };
    rec.onend = () => {
      if (recRef.current === rec) {
        recRef.current = null;
        setListeningKey(null);
      }
    };
    recRef.current = rec;
    setListeningKey(key);
    try {
      rec.start();
    } catch {
      recRef.current = null;
      setListeningKey(null);
    }
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { supported, listeningKey, start, stop };
}
