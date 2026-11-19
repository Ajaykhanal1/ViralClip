import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

// Same AES-256-GCM envelope as the API, so rotated tokens written here stay readable there.
const key = createHash('sha256').update(env.YOUTUBE_TOKEN_ENCRYPTION_KEY).digest();

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64')).join('.');
}

export function decryptToken(stored: string): string {
  const parts = stored.split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted token format');
  const [iv, tag, body] = parts.map((part) => Buffer.from(part, 'base64'));
  if (iv.length !== 12 || tag.length !== 16 || body.length === 0) throw new Error('Invalid encrypted token');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}
