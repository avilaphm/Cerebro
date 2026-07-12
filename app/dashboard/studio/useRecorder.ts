'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { pickStudioRecordingFormat } from './recordingFormat';

export type RecorderStatus = 'idle' | 'recording' | 'stopped';

export interface RecordingResult {
  url: string;
  blob: Blob;
  mimeType: string;
}

function describeVideoTracks(stream: MediaStream) {
  return stream.getVideoTracks().map((track) => {
    const settings = track.getSettings();
    return {
      label: track.label,
      width: settings.width,
      height: settings.height,
      frameRate: settings.frameRate,
      displaySurface: settings.displaySurface,
    };
  });
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
  const [paused, setPaused] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Elapsed time survives pause/resume: accumulate finished segments and add the
  // live segment while running, so the timer freezes on pause.
  const accumulatedRef = useRef(0);
  const segmentStartRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    timerRef.current = window.setInterval(() => {
      setElapsedMs(accumulatedRef.current + (performance.now() - segmentStartRef.current));
    }, 200);
  }, [clearTimer]);

  // onComplete fires from the recorder's own stop event (external system), so
  // downstream state changes happen in a callback, not inside an effect. It
  // receives the finished result so callers can grab the blob synchronously
  // (React state updates a render later — too late for offline processing).
  const start = useCallback(
    (stream: MediaStream, bitrate: number, onComplete?: (result: RecordingResult) => void) => {
      chunksRef.current = [];
      setResult(null);
      const format = pickStudioRecordingFormat();
      const recorder = new MediaRecorder(stream, {
        mimeType: format.mimeType || undefined,
        videoBitsPerSecond: bitrate,
      });
      const actualMimeType = recorder.mimeType || format.mimeType;
      console.info('[Studio recorder] start', {
        requestedMimeType: format.mimeType || 'browser default',
        actualMimeType: actualMimeType || 'browser default',
        videoBitsPerSecond: bitrate,
        videoTracks: describeVideoTracks(stream),
        audioTrackCount: stream.getAudioTracks().length,
      });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const type = actualMimeType || 'video/webm';
        const blob = new Blob(chunksRef.current, { type });
        const finished: RecordingResult = { url: URL.createObjectURL(blob), blob, mimeType: type };
        setResult(finished);
        setStatus('stopped');
        clearTimer();
        onComplete?.(finished);
      };
      recorderRef.current = recorder;
      // Timeslice so data flushes periodically; protects long recordings.
      recorder.start(1000);
      accumulatedRef.current = 0;
      segmentStartRef.current = performance.now();
      setElapsedMs(0);
      setPaused(false);
      setStatus('recording');
      startTimer();
    },
    [startTimer, clearTimer],
  );

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    recorder.pause();
    accumulatedRef.current += performance.now() - segmentStartRef.current;
    clearTimer();
    setElapsedMs(accumulatedRef.current);
    setPaused(true);
  }, [clearTimer]);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'paused') return;
    recorder.resume();
    segmentStartRef.current = performance.now();
    startTimer();
    setPaused(false);
  }, [startTimer]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    clearTimer();
    setPaused(false);
  }, [clearTimer]);

  const reset = useCallback(() => {
    setResult((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    chunksRef.current = [];
    accumulatedRef.current = 0;
    setStatus('idle');
    setElapsedMs(0);
    setPaused(false);
  }, []);

  useEffect(
    () => () => {
      clearTimer();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    },
    [clearTimer],
  );

  return { status, result, elapsedMs, paused, start, pause, resume, stop, reset };
}
