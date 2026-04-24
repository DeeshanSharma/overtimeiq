/**
 * middleware.ts
 *
 * Runs on every request before the page renders.
 * Responsibilities:
 *  1. Refresh Supabase session cookie (keeps user logged in across tab reloads)
 *  2. Protect /app routes — redirect unauthenticated users to landing page
 *  3. Redirect authenticated users away from marketing pages
 *
 * NOTE: We do NOT check users.status here because that requires a DB query.
 * Status gating happens inside the (app) layout on the client side.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
          Object.entries(headers).forEach(([key, value]) => supabaseResponse.headers.set(key, value));
        },
      },
    },
  );

  // Refresh session — IMPORTANT: do not remove this.
  // Supabase sessions are JWT-based and need periodic refresh.
  const { data } = await supabase.auth.getClaims();

  const user = data?.claims;

  const { pathname } = request.nextUrl;

  // Routes that require authentication
  const isAppRoute = ['/log', '/dashboard', '/settings'].includes(pathname);

  // Routes only for unauthenticated users
  const isAuthRoute = pathname === '/' || pathname.startsWith('/join/');

  if (!user && isAppRoute) {
    // Not logged in — send to landing page
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && (pathname === '/' || pathname === '/login')) {
    // Already logged in — send to the app
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public folder files
     * - API routes (handled independently)
     */
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|api/).*)',
  ],
};
