import type { AlertLevel, Locale } from './enums';
import { t } from './i18n';
import { formatPeriod } from './time';

/** GSM 03.38 basic character set. æ, ø, å, Æ, Ø, Å are included. */
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENDED = '^{}\\[~]|€\f';
const REPLACEMENTS: Record<string, string> = {
  '–': '-', '—': '-', '‑': '-', '‘': "'", '’': "'", '‚': "'", '“': '"', '”': '"', '„': '"', '«': '"', '»': '"',
  '…': '...', ' ': ' ', ' ': ' ', ' ': ' ', '\t': ' ', '´': "'", '`': "'", '°': ' grader',
  'á': 'a', 'â': 'a', 'ã': 'a', 'ç': 'c', 'ê': 'e', 'ë': 'e', 'í': 'i', 'î': 'i', 'ï': 'i', 'ó': 'o', 'ô': 'o',
  'õ': 'o', 'ú': 'u', 'û': 'u', 'ý': 'y', 'ÿ': 'y', 'Á': 'A', 'À': 'A', 'Â': 'A', 'È': 'E', 'Ê': 'E', 'Í': 'I',
  'Ó': 'O', 'Ú': 'U', 'š': 's', 'Š': 'S', 'ž': 'z', 'Ž': 'Z', 'č': 'c', 'Č': 'C', 'đ': 'd', 'Đ': 'D', 'ŋ': 'n',
  'Ŋ': 'N', 'ŧ': 't', 'Ŧ': 'T',
};

export function isGsm7(text: string): boolean {
  return [...text].every((c) => GSM7_BASIC.includes(c) || GSM7_EXTENDED.includes(c));
}

/** Replace or drop characters outside GSM 7-bit so the SMS stays in the 160-character format. */
export function toGsm7(text: string): string {
  let out = '';
  for (const c of text) {
    if (GSM7_BASIC.includes(c) || GSM7_EXTENDED.includes(c)) out += c;
    else if (REPLACEMENTS[c] !== undefined) out += REPLACEMENTS[c];
  }
  return out.replace(/ {2,}/g, ' ');
}

/** Length in septets (extended characters count twice). */
export function gsm7Length(text: string): number {
  let n = 0;
  for (const c of text) n += GSM7_EXTENDED.includes(c) ? 2 : 1;
  return n;
}

export function truncate(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : chars.slice(0, max).join('').trimEnd();
}

export const SMS_MAX = 160;
export const SMS_OBJECT_NAME_MAX = 20;

function stripDot(s: string): string {
  return s.trim().replace(/[.\s]+$/, '');
}

export interface AlertMessageInput {
  locale: Locale;
  level: AlertLevel;
  situationName: string;
  objectName: string;
  headline: string;
  onset: Date | string | null;
  expires: Date | string;
  link: string;
}

export function pushAlertMessage(i: AlertMessageInput): { title: string; body: string } {
  const title = t(i.locale, 'msg.push.title', {
    colourAdj: t(i.locale, `msg.colourAdj.${i.level}`),
    situation: i.situationName,
    object: i.objectName,
  });
  const body = t(i.locale, 'msg.push.body', {
    action: t(i.locale, `level.action.${i.level}`),
    headline: stripDot(i.headline),
    period: formatPeriod(i.onset, i.expires, i.locale),
  }).replace(/\.\s*\./g, '.');
  return { title, body };
}

export function smsAlertMessage(i: AlertMessageInput): string {
  const text = toGsm7(
    t(i.locale, 'msg.sms', {
      LEVEL: t(i.locale, `msg.level.upper.${i.level}`),
      situation: i.situationName,
      object: truncate(i.objectName, SMS_OBJECT_NAME_MAX),
      action: t(i.locale, `level.action.${i.level}`),
      period: formatPeriod(i.onset, i.expires, i.locale),
      link: i.link,
    }),
  );
  if (gsm7Length(text) <= SMS_MAX) return text;
  // Keep the link intact; shorten the text before it.
  const idx = text.lastIndexOf(i.link);
  const tail = text.slice(idx);
  const marker = i.locale === 'en' ? ' See the app: ' : ' Se appen: ';
  const head = text.slice(0, Math.max(0, idx - marker.length));
  const budget = SMS_MAX - gsm7Length(marker + tail) - 2;
  let cut = '';
  for (const c of head) {
    if (gsm7Length(cut + c) > budget) break;
    cut += c;
  }
  return `${cut.trimEnd()}..${marker}${tail}`;
}

export function cancelMessage(locale: Locale, situationName: string, objectName: string): string {
  return t(locale, 'msg.cancelled', { situation: situationName, object: objectName });
}

export function reminderMessage(locale: Locale, objectName: string): string {
  return t(locale, 'msg.reminder', { object: objectName });
}

/** Display name when no nickname is set: object type and place (spec: object location). */
export function objectDisplayName(nickname: string | null | undefined, typeName: string | null, placeLabel: string | null, fallback: string): string {
  if (nickname && nickname.trim()) return nickname.trim();
  const parts = [typeName, placeLabel].filter((x): x is string => !!x);
  return parts.length ? parts.join(', ') : fallback;
}
