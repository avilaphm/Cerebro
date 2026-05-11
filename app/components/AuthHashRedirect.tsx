'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

// Handles implicit-flow auth responses that land on the root page as URL hash fragments.
// Supabase admin magic links and recovery emails arrive as /#access_token=...
export default function AuthHashRedirect() {
  const router = useRouter();

  useEffect(() => {
    const raw = window.location.hash.slice(1); // strip leading #
    if (!raw) return;

    const params = new URLSearchParams(raw);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token') ?? '';
    const errorParam = params.get('error');
    const type = params.get('type');

    // Clear hash from URL immediately so it doesn't persist on refresh
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    const next = new URLSearchParams(window.location.search).get('next');
    const authErrorPath = window.location.pathname.startsWith('/client-login') || next?.startsWith('/client')
      ? '/client-login'
      : '/login';

    if (errorParam) {
      router.replace(`${authErrorPath}?error=link_expired`);
      return;
    }

    if (!accessToken) return;

    const supabase = createClient();
    supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ data, error }) => {
        if (error || !data.session) {
          router.replace(`${authErrorPath}?error=session_failed`);
          return;
        }
        if (type === 'recovery') {
          router.replace(`/auth/update-password?next=${encodeURIComponent(next ?? '/dashboard')}`);
        } else if (type === 'invite') {
          router.replace('/client-setup');
        } else {
          void supabase
            .from('profiles')
            .select('role')
            .eq('id', data.session.user.id)
            .maybeSingle()
            .then(({ data: profile }) => {
              if (next) {
                router.replace(next);
                return;
              }
              router.replace(profile?.role === 'client' ? '/client' : '/dashboard');
            });
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
