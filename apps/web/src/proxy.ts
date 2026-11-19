import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { AUTH_COOKIE_NAMES, DEV_AUTH_ACCESS_SECRET } from '@viralclip/shared';

const secret = new TextEncoder().encode(process.env.AUTH_ACCESS_SECRET || DEV_AUTH_ACCESS_SECRET);

async function hasValidAccessToken(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(AUTH_COOKIE_NAMES.access)?.value;
  if (!token) return false;

  try {
    await jwtVerify(token, secret, { algorithms: ['HS256'] });
    return true;
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const signedIn = await hasValidAccessToken(request);

  const isProtected =
    pathname.startsWith('/settings') ||
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/projects') ||
    pathname.startsWith('/imports') ||
    pathname.startsWith('/clips') ||
    pathname.startsWith('/shorts') ||
    pathname.startsWith('/editor') ||
    pathname.startsWith('/render') ||
    pathname.startsWith('/rights') ||
    pathname.startsWith('/youtube') ||
    pathname.startsWith('/notifications') ||
    pathname.startsWith('/usage') ||
    pathname.startsWith('/subscription');
  if (isProtected) {
    // The refresh cookie can recover an expired access token in the browser.
    if (signedIn || request.cookies.has(AUTH_COOKIE_NAMES.refresh)) return NextResponse.next();
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (signedIn) return NextResponse.redirect(new URL('/dashboard', request.url));
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/login',
    '/register',
    '/forgot-password',
    '/dashboard/:path*',
    '/projects/:path*',
    '/imports/:path*',
    '/clips/:path*',
    '/shorts/:path*',
    '/editor/:path*',
    '/render/:path*',
    '/rights/:path*',
    '/youtube/:path*',
    '/notifications/:path*',
    '/usage/:path*',
    '/subscription/:path*',
    '/settings/:path*',
  ],
};
