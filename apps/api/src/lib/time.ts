import { osloParts } from '@varsling/shared';

/** YYYY-MM in Europe/Oslo, used for the monthly SMS cap. */
export function osloMonth(date: Date): string {
  return osloParts(date).ymd.slice(0, 7);
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

export function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return (typeof d === 'string' ? new Date(d) : d).toISOString();
}

export function isoReq(d: Date | string): string {
  return (typeof d === 'string' ? new Date(d) : d).toISOString();
}
