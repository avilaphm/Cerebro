'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

// The Document Picture-in-Picture API is Chrome-only and not yet in lib.dom, so
// it is typed narrowly here rather than with `any`.
interface DocumentPipWindowOptions {
  width?: number;
  height?: number;
}
interface DocumentPictureInPicture {
  readonly window: Window | null;
  requestWindow(options?: DocumentPipWindowOptions): Promise<Window>;
}

function getDpip(): DocumentPictureInPicture | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { documentPictureInPicture?: DocumentPictureInPicture };
  return w.documentPictureInPicture ?? null;
}

const noopSubscribe = () => () => {};

export function useDocumentPipSupported(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => getDpip() !== null,
    () => false,
  );
}

/**
 * Owns a single Document Picture-in-Picture window: an always-on-top window that
 * survives switching browser tabs and even focusing other apps. `open` must be
 * called from a user gesture (Chrome requires activation). The window is closed
 * on unmount so it never outlives Studio.
 */
export function useDocumentPip() {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const pipRef = useRef<Window | null>(null);

  const clear = useCallback(() => {
    pipRef.current = null;
    setPipWindow(null);
  }, []);

  const close = useCallback(() => {
    pipRef.current?.close();
    clear();
  }, [clear]);

  const open = useCallback(
    async (options?: DocumentPipWindowOptions) => {
      const dpip = getDpip();
      if (!dpip || pipRef.current) return;
      try {
        const w = await dpip.requestWindow(options);
        // The PiP document starts blank; give the body a dark, edge-to-edge base
        // so the portalled self-view fills it with no white margin.
        w.document.body.style.margin = '0';
        w.document.body.style.overflow = 'hidden';
        w.document.body.style.background = '#000';
        w.addEventListener('pagehide', clear, { once: true });
        pipRef.current = w;
        setPipWindow(w);
      } catch {
        /* user dismissed or the request was blocked — no-op */
      }
    },
    [clear],
  );

  useEffect(() => () => pipRef.current?.close(), []);

  return { pipWindow, open, close };
}
