import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { nb } from '../src/i18n/nb';
import { gsm7Length, isGsm7, pushAlertMessage, smsAlertMessage, toGsm7 } from '../src/messages';
import { formatPeriod } from '../src/time';

const base = {
  level: 'yellow' as const,
  situationName: 'Vindstyrke',
  objectName: 'Bjørnvika',
  headline: 'Kraftige vindkast, gult nivå',
  onset: '2026-11-05T05:00:00Z',
  expires: '2026-11-05T17:00:00Z',
  link: 'https://varsling.example/a/abc',
};

describe('message copy', () => {
  it('A1: push title and body in Norwegian', () => {
    const m = pushAlertMessage({ ...base, locale: 'nb' });
    expect(m.title).toBe('Gult varsel: Vindstyrke – Bjørnvika');
    expect(m.body).toBe('Tiltak må vurderes. Kraftige vindkast, gult nivå. Gjelder 05.11 06:00–18:00.');
  });

  it('red push in English', () => {
    const m = pushAlertMessage({ ...base, locale: 'en', level: 'red', situationName: 'Wind' });
    expect(m.title).toBe('Red alert: Wind – Bjørnvika');
    expect(m.body.startsWith('Action strongly recommended.')).toBe(true);
  });

  it('SMS stays GSM-7, within 160, truncates nicknames to 20 and keeps the link', () => {
    const sms = smsAlertMessage({ ...base, locale: 'nb', level: 'red', objectName: 'Hytta vår på fjellet ved Storvatnet 🏔️', situationName: 'Store nedbørsmengder' });
    expect(isGsm7(sms)).toBe(true);
    expect(gsm7Length(sms)).toBeLessThanOrEqual(160);
    expect(sms.startsWith('VARSEL RØD: Store nedbørsmengder, Hytta vår på fjellet. Tiltak er sterkt anbefalt.')).toBe(true);
    expect(sms.endsWith(base.link)).toBe(true);
  });

  it('toGsm7 keeps æøå and drops emoji', () => {
    expect(toGsm7('Blåbær – ærlig 😀 Øst')).toBe('Blåbær - ærlig Øst');
  });

  it('period across days', () => {
    expect(formatPeriod('2026-11-05T05:00:00Z', '2026-11-06T11:00:00Z')).toBe('05.11 06:00–06.11 12:00');
  });

  it('every nb key has an en translation', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(nb).sort());
  });
});
