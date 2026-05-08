'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const SESSION_KEY = 'cerebro_session_id';
const TRACKED_PREFIX = 'cerebro_tracked_';

// Skip tracking on private surfaces.
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

export default function VisitTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || !isPublicPath(pathname)) return;

    // Dedupe: don't log the same path twice in one session.
    let alreadyTracked = false;
    try {
      const key = TRACKED_PREFIX + pathname;
      alreadyTracked = sessionStorage.getItem(key) === '1';
      if (!alreadyTracked) sessionStorage.setItem(key, '1');
    } catch {
      // sessionStorage blocked — track every time, oh well
    }
    if (alreadyTracked) return;

    const params = new URLSearchParams(window.location.search);
    const body = JSON.stringify({
      path: pathname,
      referrer: document.referrer || null,
      utm_source: params.get('utm_source'),
      utm_medium: params.get('utm_medium'),
      utm_campaign: params.get('utm_campaign'),
      utm_term: params.get('utm_term'),
      utm_content: params.get('utm_content'),
      session_id: getSessionId(),
    });

    // Use sendBeacon when available so the request survives navigation.
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon('/api/track/visit', blob);
        return;
      }
    } catch {
      // fall through to fetch
    }
    fetch('/api/track/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  }, [pathname]);

  return null;
}
