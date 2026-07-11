'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Orientation } from './types';

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

// Request a capture resolution that matches the target orientation. A phone held
// in portrait otherwise hands back a landscape (1920x1080) frame, which then gets
// cover-cropped into the portrait stage — that is the "sideways / zoomed-in"
// camera. In portrait we ask for a tall frame so the sensor delivers portrait
// pixels and no crop is needed. Desktop (landscape) is unchanged.
function studioCameraConstraints(
  deviceId?: string,
  orientation: Orientation = 'landscape',
): MediaTrackConstraints {
  const portrait = orientation === 'portrait';
  return {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    width: { ideal: portrait ? 1080 : 1920, max: 1920 },
    height: { ideal: portrait ? 1920 : 1080, max: 1920 },
    frameRate: { ideal: 30, max: 30 },
  };
}

const STUDIO_SCREEN_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  displaySurface: 'monitor',
  width: { ideal: 1920, max: 1920 },
  height: { ideal: 1080, max: 1080 },
  frameRate: { ideal: 30, max: 30 },
};

export interface UseMediaStreams {
  cameras: DeviceOption[];
  mics: DeviceOption[];
  camMicStream: MediaStream | null;
  screenStream: MediaStream | null;
  camMicError: SourceError;
  screenError: SourceError;
  startCamMic: (cameraId?: string, micId?: string) => Promise<void>;
  switchCamera: (cameraId: string) => Promise<void>;
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
export function useMediaStreams(orientation: Orientation = 'landscape'): UseMediaStreams {
  // Read through a ref so the acquire callbacks stay referentially stable (other
  // effects depend on their identity) while always seeing the latest orientation.
  // useRef seeds the correct initial value; the effect keeps it in sync on change
  // (assigning .current during render is disallowed by react-hooks/refs).
  const orientationRef = useRef<Orientation>(orientation);
  useEffect(() => {
    orientationRef.current = orientation;
  }, [orientation]);

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
          video: studioCameraConstraints(cameraId, orientationRef.current),
          audio: micId ? { deviceId: { exact: micId } } : true,
        });
        stopStream(camMicRef.current);
        camMicRef.current = stream;
        setCamMicStream(stream);
        await refreshDevices();
      } catch (err) {
        setCamMicError(describeMediaError(err, 'camera or microphone'));
        // Still populate the device list so a failed default camera (e.g. a busy
        // built-in webcam) doesn't hide the others — the user can switch to their
        // phone / Continuity Camera from the dropdown and retry.
        await refreshDevices();
      }
    },
    [refreshDevices],
  );

  // Swap the camera without disturbing the mic. Hot-replaces only the video track
  // in the live stream, so whichever recorder audio path is active (direct mic
  // track by default, Web Audio only when system audio is mixed) is never
  // interrupted. Falls back to a full acquire if nothing is live yet.
  const switchCamera = useCallback(
    async (cameraId: string) => {
      const current = camMicRef.current;
      if (!current) {
        await startCamMic(cameraId);
        return;
      }
      setCamMicError(null);
      try {
        const fresh = await navigator.mediaDevices.getUserMedia({
          video: studioCameraConstraints(cameraId, orientationRef.current),
          audio: false,
        });
        const nextVideo = fresh.getVideoTracks()[0];
        if (!nextVideo) {
          fresh.getTracks().forEach((t) => t.stop());
          return;
        }
        current.getVideoTracks().forEach((t) => {
          current.removeTrack(t);
          t.stop();
        });
        current.addTrack(nextVideo);
        // Same stream reference: the recorder's audio and every bound <video>
        // keep playing and just pick up the new video track live.
        setCamMicStream(current);
        await refreshDevices();
      } catch (err) {
        setCamMicError(describeMediaError(err, 'camera'));
      }
    },
    [startCamMic, refreshDevices],
  );

  const startScreen = useCallback(async (systemAudio: boolean) => {
    setScreenError(null);
    try {
      // Pre-select "Entire Screen" in the picker so switching between tabs and
      // apps is captured — a single Chrome-tab share only records that one tab.
      const options: ScreenShareOptions = {
        video: STUDIO_SCREEN_VIDEO_CONSTRAINTS,
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
    switchCamera,
    startScreen,
    stopScreen,
    stopAll,
    registerScreenEnded,
  };
}
