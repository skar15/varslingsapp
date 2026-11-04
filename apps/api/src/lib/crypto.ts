import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Random single-use token (claim, invitation). Only the hash is stored. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function key(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/** AES-256-GCM; output is base64url(iv | tag | ciphertext). */
export function encrypt(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url');
}

export function decrypt(payload: string, secret: string): string {
  const buf = Buffer.from(payload, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key(secret), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}
