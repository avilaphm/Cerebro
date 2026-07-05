'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface DeviceOption {
  deviceId: string;
  label: string;
}

export type SourceError = string | null;

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function describeMediaError(err: unknown, source: string): string {
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return `Permission to access your ${source} was denied. Allow it in Chrome and retry.`;
    case 'NotFoundError':
    case 'OverconstrainedError':
      return `No ${source} was found. Connect one and retry.`;
    case 'NotReadableError':
      return `Your ${source} is in use by another app. Close it and retry.`;
    default:
      return `Could not start your ${source}. Retry.`;
  }
}

// Chrome-only getDisplayMedia picker hints not yet in lib.dom's
// DisplayMediaStreamOptions. `selfBrowserSurface: 'exclude'` keeps the Studio
// tab out of the list; `surfaceSwitching: 'include'` lets you swap the shared
// surface mid-recording without restarting.
interface ScreenShareOptions extends DisplayMediaStreamOptions {
  surfaceSwitching?: 'include' | 'exclude';
  selfBrowserSurface?: 'include' | 'exclude';
}

export interface UseMediaStreams {
  cameras: DeviceOption[];
  mics: DeviceOption[];
  camMicStream: MediaStream | null;
  screenStream: MediaStream | null;
  camMicError: SourceError;
  screenError: SourceError;
  startCamMic: (cameraId?: string, micId?: string) => Promise<void>;
  startScreen: (systemAudio: boolean) => Promise<void>;
  stopScreen: () => void;
  stopAll: () => void;
  registerScreenEnded: (cb: (() => void) | null) => void;
}

/**
 * Owns every getUserMedia / getDisplayMedia track. Guarantees teardown on
 * unmount so no camera light is ever left on, and reports human-readable
 * errors per source instead of dead-ending.
 */
export function useMediaStreams(): UseMediaStreams {
  const [cameras, setCameras] = useState<DeviceOption[]>([]);
  const [mics, setMics] = useState<DeviceOption[]>([]);
  const [camMicStream, setCamMicStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [camMicError, setCamMicError] = useState<SourceError>(null);
  const [screenError, setScreenError] = useState<SourceError>(null);

  const camMicRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const screenEndedCb = useRef<(() => void) | null>(null);

  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameras(
        devices
          .filter((d) => d.kind === 'videoinput')
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` })),
      );
      setMics(
        devices
          .filter((d) => d.kind === 'audioinput')
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` })),
      );
    } catch {
      /* enumeration is best-effort; ignore */
    }
  }, []);

  const startCamMic = useCallback(
    async (cameraId?: string, micId?: string) => {
      setCamMicError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: cameraId ? { exact: cameraId } : undefined,
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: micId ? { deviceId: { exact: micId } } : true,
        });
        stopStream(camMicRef.current);
        camMicRef.current = stream;
        setCamMicStream(stream);
        await refreshDevices();
      } catch (err) {
        setCamMicError(describeMediaError(err, 'camera or microphone'));
      }
    },
    [refreshDevices],
  );

  const startScreen = useCallback(async (systemAudio: boolean) => {
    setScreenError(null);
    try {
      // Pre-select "Entire Screen" in the picker so switching between tabs and
      // apps is captured — a single Chrome-tab share only records that one tab.
      const options: ScreenShareOptions = {
        video: { displaySurface: 'monitor' },
        audio: systemAudio,
        surfaceSwitching: 'include',
        selfBrowserSurface: 'exclude',
      };
      const stream = await navigator.mediaDevices.getDisplayMedia(options);
      stopStream(screenRef.current);
      screenRef.current = stream;
      setScreenStream(stream);
      // Native "Stop sharing" ends the video track — surface it to the app.
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        screenRef.current = null;
        setScreenStream(null);
        screenEndedCb.current?.();
      });
    } catch (err) {
      // A cancelled picker throws NotAllowedError; treat as a soft no-op.
      if (err instanceof DOMException && err.name === 'NotAllowedError') return;
      setScreenError(describeMediaError(err, 'screen'));
    }
  }, []);

  const stopScreen = useCallback(() => {
    stopStream(screenRef.current);
    screenRef.current = null;
    setScreenStream(null);
  }, []);

  const stopAll = useCallback(() => {
    stopStream(camMicRef.current);
    camMicRef.current = null;
    setCamMicStream(null);
    stopStream(screenRef.current);
    screenRef.current = null;
    setScreenStream(null);
  }, []);

  const registerScreenEnded = useCallback((cb: (() => void) | null) => {
    screenEndedCb.current = cb;
  }, []);

  // Refresh device labels when hardware is plugged/unplugged.
  useEffect(() => {
    const handler = () => void refreshDevices();
    navigator.mediaDevices.addEventListener('devicechange', handler);
    return () => navigator.mediaDevices.removeEventListener('devicechange', handler);
  }, [refreshDevices]);

  // Hard guarantee: stop every track on unmount / navigation.
  useEffect(
    () => () => {
      stopStream(camMicRef.current);
      stopStream(screenRef.current);
    },
    [],
  );

  return {
    cameras,
    mics,
    camMicStream,
    screenStream,
    camMicError,
    screenError,
    startCamMic,
    startScreen,
    stopScreen,
    stopAll,
    registerScreenEnded,
  };
}
