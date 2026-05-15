'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const SESSION_KEY = 'cerebro_session_id';
const TRACKED_PREFIX = 'cerebro_tracked_';

function isPublicPath(path: string): boolean {
  if (!path) return false;
  if (path.startsWith('/dashboard')) return false;
  if (path.startsWith('/login')) return false;
  if (path.startsWith('/auth')) return false;
  if (path.startsWith('/api')) return false;
  return true;
}

function getSessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function beacon(url: string, data: object) {
  const payload = JSON.stringify(data);
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
      return;
    }
  } catch { /* fall through */ }
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
}

export default function VisitTracker() {
  const pathname = usePathname();
  const entryTime = useRef<number>(0);
  const trackedPath = useRef<string>('');

  useEffect(() => {
    if (!pathname || !isPublicPath(pathname)) return;

    let alreadyTracked = false;
    try {
      const key = TRACKED_PREFIX + pathname;
      alreadyTracked = sessionStorage.getItem(key) === '1';
      if (!alreadyTracked) sessionStorage.setItem(key, '1');
    } catch { /* sessionStorage blocked */ }
    if (alreadyTracked) return;

    const sessionId = getSessionId();
    const params = new URLSearchParams(window.location.search);
    beacon('/api/track/visit', {
      path: pathname,
      referrer: document.referrer || null,
      utm_source: params.get('utm_source'),
      utm_medium: params.get('utm_medium'),
      utm_campaign: params.get('utm_campaign'),
      utm_term: params.get('utm_term'),
      utm_content: params.get('utm_content'),
      session_id: sessionId,
    });

    entryTime.current = Date.now();
    trackedPath.current = pathname;
  }, [pathname]);

  // Send time-on-page when tab is hidden or closed
  useEffect(() => {
    if (!pathname || !isPublicPath(pathname)) return;

    const sendDuration = () => {
      if (!entryTime.current || !trackedPath.current) return;
      const seconds = Math.round((Date.now() - entryTime.current) / 1000);
      if (seconds < 2) return;
      beacon('/api/track/duration', {
        session_id: getSessionId(),
        path: trackedPath.current,
        duration_seconds: seconds,
      });
    };

    const onVisibility = () => { if (document.visibilityState === 'hidden') sendDuration(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [pathname]);

  return null;
}
