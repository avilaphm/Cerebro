'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderStatus = 'idle' | 'recording' | 'stopped';

export interface RecordingResult {
  url: string;
  blob: Blob;
  mimeType: string;
}

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

function pickMimeType(): string {
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

/**
 * Wraps MediaRecorder: collects chunks, produces a downloadable blob + object
 * URL on stop, and tracks elapsed time. Revokes URLs and stops any live
 * recorder on unmount so nothing leaks.
 */
export function useRecorder() {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [result, setResult] = useState<RecordingResult | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // onComplete fires from the recorder's own stop event (external system), so
  // downstream state changes happen in a callback, not inside an effect.
  const start = useCallback(
    (stream: MediaStream, bitrate: number, onComplete?: () => void) => {
      chunksRef.current = [];
      setResult(null);
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, {
        mimeType: mimeType || undefined,
        videoBitsPerSecond: bitrate,
      });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const type = mimeType || 'video/webm';
        const blob = new Blob(chunksRef.current, { type });
        setResult({ url: URL.createObjectURL(blob), blob, mimeType: type });
        setStatus('stopped');
        clearTimer();
        onComplete?.();
      };
    recorderRef.current = recorder;
    // Timeslice so data flushes periodically; protects long recordings.
    recorder.start(1000);
    startTimeRef.current = performance.now();
    setElapsedMs(0);
    setStatus('recording');
    timerRef.current = window.setInterval(() => {
      setElapsedMs(performance.now() - startTimeRef.current);
    }, 200);
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    clearTimer();
  }, []);

  const reset = useCallback(() => {
    setResult((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    chunksRef.current = [];
    setStatus('idle');
    setElapsedMs(0);
  }, []);

  useEffect(
    () => () => {
      clearTimer();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    },
    [],
  );

  return { status, result, elapsedMs, start, stop, reset };
}
