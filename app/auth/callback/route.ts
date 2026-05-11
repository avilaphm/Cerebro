import { createServerClient } from '@supabase/ssr';
import type { EmailOtpType } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const next = normalizeNext(searchParams.get('next'), origin);

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        },
      },
    },
  );

  // PKCE flow (OAuth, magic link from app)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const redirectTo = type === 'recovery'
        ? `/auth/update-password?next=${encodeURIComponent(next)}`
        : await resolvePostAuthRedirect(supabase, next);
      return NextResponse.redirect(`${origin}${redirectTo}`);
    }
  }

  // Email link flow (admin-sent recovery, magic link from dashboard)
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as EmailOtpType,
    });
    if (!error) {
      const redirectTo = type === 'recovery'
        ? `/auth/update-password?next=${encodeURIComponent(next)}`
        : await resolvePostAuthRedirect(supabase, next);
      return NextResponse.redirect(`${origin}${redirectTo}`);
    }
  }

  const loginPath = next.startsWith('/client') ? '/client-login' : '/login';
  return NextResponse.redirect(`${origin}${loginPath}?error=link_expired`);
}

function normalizeNext(rawNext: string | null, origin: string) {
  if (!rawNext) return '/dashboard';
  if (rawNext.startsWith('/')) return rawNext;

  try {
    const nextUrl = new URL(rawNext);
    if (nextUrl.origin !== origin) return '/dashboard';
    if (nextUrl.pathname === '/auth/callback') {
      return normalizeNext(nextUrl.searchParams.get('next'), origin);
    }
    return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  } catch {
    return '/dashboard';
  }
}

async function resolvePostAuthRedirect(
  supabase: ReturnType<typeof createServerClient>,
  next: string,
) {
  if (next !== '/dashboard') return next;

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return next;

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  return profile?.role === 'client' ? '/client' : next;
}
