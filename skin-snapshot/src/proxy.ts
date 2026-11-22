import { NextResponse, type NextRequest } from 'next/server';

// Sends visitors without a language prefix to /en (or /hi when they chose Hindi earlier in this visit).
const SKIP = /^\/(en|hi|api|console|_next|vision|icon\.svg|favicon\.ico|robots\.txt|sitemap\.xml)(\/|$)/;

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (SKIP.test(pathname) || /\.[a-z0-9]{2,5}$/i.test(pathname)) return NextResponse.next();
  const pref = req.cookies.get('ss_lang')?.value === 'hi' ? 'hi' : 'en';
  const url = req.nextUrl.clone();
  url.pathname = `/${pref}${pathname === '/' ? '' : pathname}`;
  url.search = search;
  return NextResponse.redirect(url, 307);
}

export const config = { matcher: ['/((?!_next/static|_next/image|vision/).*)'] };
