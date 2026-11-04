import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { normaliseLocale, t } from '@varsling/shared';
import { Providers } from '@/components/Providers';
import '../globals.css';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = normaliseLocale((await params).locale);
  return { title: t(locale, 'app.name'), description: t(locale, 'app.tagline') };
}

export function generateStaticParams() {
  return [{ locale: 'nb' }, { locale: 'en' }];
}

export default async function RootLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!['nb', 'en'].includes(locale)) notFound();
  return (
    <html lang={locale === 'en' ? 'en' : 'nb'}>
      <body>
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
