import type { Locale } from './enums';

export const TIME_ZONE = 'Europe/Oslo';

interface Parts {
  day: string;
  month: string;
  hour: string;
  minute: string;
  weekday: string;
  ymd: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(locale: Locale): Intl.DateTimeFormat {
  let f = formatters.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'nb-NO', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    formatters.set(locale, f);
  }
  return f;
}

export function osloParts(date: Date | string, locale: Locale = 'nb'): Parts {
  const d = typeof date === 'string' ? new Date(date) : date;
  const p = Object.fromEntries(formatter(locale).formatToParts(d).map((x) => [x.type, x.value]));
  return {
    day: p.day ?? '',
    month: p.month ?? '',
    hour: p.hour === '24' ? '00' : (p.hour ?? ''),
    minute: p.minute ?? '',
    weekday: (p.weekday ?? '').replace(/\.$/, ''),
    ymd: `${p.year}-${p.month}-${p.day}`,
  };
}

/** "05.11 06:00" in Oslo time. */
export function formatDateTime(date: Date | string, locale: Locale = 'nb'): string {
  const p = osloParts(date, locale);
  return `${p.day}.${p.month} ${p.hour}:${p.minute}`;
}

export function formatTime(date: Date | string, locale: Locale = 'nb'): string {
  const p = osloParts(date, locale);
  return `${p.hour}:${p.minute}`;
}

/** "05.11 06:00–18:00" or "05.11 06:00–06.11 12:00". */
export function formatPeriod(from: Date | string | null, to: Date | string, locale: Locale = 'nb'): string {
  const b = osloParts(to, locale);
  if (!from) return `–${b.day}.${b.month} ${b.hour}:${b.minute}`;
  const a = osloParts(from, locale);
  if (a.ymd === b.ymd) return `${a.day}.${a.month} ${a.hour}:${a.minute}–${b.hour}:${b.minute}`;
  return `${a.day}.${a.month} ${a.hour}:${a.minute}–${b.day}.${b.month} ${b.hour}:${b.minute}`;
}
