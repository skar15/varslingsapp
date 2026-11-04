import { NextResponse, type NextRequest } from 'next/server';

const LOCALES = ['nb', 'en'];

/** Every page lives under /nb or /en. Links without a locale (SMS, email) get Norwegian. */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const first = pathname.split('/')[1] ?? '';
  if (LOCALES.includes(first)) return NextResponse.next();
  const preferred = req.cookies.get('locale')?.value;
  const locale = preferred && LOCALES.includes(preferred) ? preferred : 'nb';
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/((?!_next|api|favicon.ico|.*\\..*).*)'] };
