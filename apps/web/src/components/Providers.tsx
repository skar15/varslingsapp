'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { LocaleProvider } from '@/lib/i18n';

export function Providers({ locale, children }: { locale: string; children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, refetchOnWindowFocus: true } } }));
  return (
    <LocaleProvider locale={locale}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </LocaleProvider>
  );
}
