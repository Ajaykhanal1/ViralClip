import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import type { UserRole } from '@viralclip/shared';
import { env } from '../../config/env.js';

const BCRYPT_ROUNDS = 12;
const ACCESS_TOKEN_ISSUER = 'viralclip';
const ACCESS_TOKEN_AUDIENCE = 'viralclip-api';
const secret = new TextEncoder().encode(env.AUTH_ACCESS_SECRET);

export const ACCESS_TTL_SECONDS = env.AUTH_ACCESS_TTL_SECONDS;
export const REFRESH_TTL_MS = env.AUTH_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000;

// A real hash of a throwaway value: unknown emails still pay the same bcrypt cost as known ones.
const DUMMY_PASSWORD_HASH = '$2b$12$fpsEi9zubqd7/qtg4K.QwuCPncvvKjn9eSS2XlWkR6s3ZIDrJx25S';

export interface AuthPrincipal {
  id: number;
  role: UserRole;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/** Compares even when the account is missing, so login timing does not reveal registration. */
export function verifyLoginPassword(password: string, hash: string | null): Promise<boolean> {
  return bcrypt.compare(password, hash || DUMMY_PASSWORD_HASH);
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function signAccessToken(
  principal: AuthPrincipal,
  ttlSeconds = ACCESS_TTL_SECONDS,
): Promise<string> {
  return new SignJWT({ role: principal.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(String(principal.id))
    .setIssuer(ACCESS_TOKEN_ISSUER)
    .setAudience(ACCESS_TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AuthPrincipal | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
      issuer: ACCESS_TOKEN_ISSUER,
      audience: ACCESS_TOKEN_AUDIENCE,
    });
    const id = Number(payload.sub);
    const role = payload.role;
    if (!Number.isInteger(id) || id <= 0) return null;
    if (role !== 'user' && role !== 'admin') return null;
    return { id, role };
  } catch {
    return null;
  }
}
