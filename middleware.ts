import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const COACH_HOSTS = ['pedroavila.coach', 'www.pedroavila.coach'];
const DISCOVERY_SESSION_COOKIE = 'bd_session';

async function discoverySessionToken(passcode: string): Promise<string> {
  const bytes = new TextEncoder().encode(`business-discovery:${passcode}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function middleware(request: NextRequest) {
  const host = request.headers.get('host') ?? '';
  if (COACH_HOSTS.includes(host) && request.nextUrl.pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = '/coach';
    return NextResponse.rewrite(url);
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isDashboard = request.nextUrl.pathname.startsWith('/dashboard');
  const isClient = request.nextUrl.pathname.startsWith('/client');
  const isDiscovery =
    request.nextUrl.pathname === '/discovery' ||
    request.nextUrl.pathname.startsWith('/discovery/');

  if ((isDashboard || isDiscovery) && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    return NextResponse.redirect(loginUrl);
  }

  if (isClient && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/client-login';
    return NextResponse.redirect(loginUrl);
  }

  const discoveryPasscode = process.env.APP_PASSCODE;
  if (
    isDiscovery &&
    user &&
    discoveryPasscode &&
    !request.cookies.get(DISCOVERY_SESSION_COOKIE)?.value
  ) {
    const response = NextResponse.redirect(request.nextUrl);
    response.cookies.set(
      DISCOVERY_SESSION_COOKIE,
      await discoverySessionToken(discoveryPasscode),
      {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 60 * 60 * 24 * 90,
      },
    );
    return response;
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/', '/dashboard/:path*', '/client/:path*', '/discovery/:path*'],
};
