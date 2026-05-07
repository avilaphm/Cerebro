'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

// Handles implicit-flow auth responses that land on the root page as URL hash fragments.
// Supabase magic links (admin-sent) arrive as /#access_token=... and /#error=...
export default function AuthHashRedirect() {
  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;

    if (hash.includes('error=')) {
      window.location.hash = '';
      router.replace('/login?error=link_expired');
      return;
    }

    if (hash.includes('access_token=')) {
      const supabase = createClient();

      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          router.replace('/dashboard');
          return;
        }
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
          if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
            subscription.unsubscribe();
            router.replace('/dashboard');
          }
        });
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
