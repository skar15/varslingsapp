import pino from 'pino';

/**
 * JSON logs. Rule 11: never log secrets, phone numbers, emails or coordinates.
 * The redact list is a safety net; code logs ids only.
 */
export function createLogger(level = 'info') {
  return pino({
    level,
    redact: {
      paths: [
        'req.headers.authorization', 'req.headers.cookie', 'req.headers["stripe-signature"]', 'req.headers["x-admin-key"]',
        '*.phone', '*.phone_e164', '*.email', '*.lat', '*.lon', '*.coordinates', '*.geometry', '*.push_token', '*.token',
      ],
      censor: '[redacted]',
    },
  });
}
export type Logger = pino.Logger;
