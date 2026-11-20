// @vitest-environment node
import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const SECRET = 'test-access-secret-at-least-32-characters';
const KEY = Uint8Array.from(Buffer.from(SECRET, 'utf8'));
let proxy: typeof import('@/proxy').proxy;

function request(path: string, cookies: Record<string, string> = {}) {
  const headers = new Headers();
  if (Object.keys(cookies).length) {
    headers.set('cookie', Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '));
  }
  return new NextRequest(`https://app.example.com${path}`, { headers });
}

beforeAll(async () => {
  vi.stubEnv('AUTH_ACCESS_SECRET', SECRET);
  ({ proxy } = await import('@/proxy'));
});

afterAll(() => vi.unstubAllEnvs());

describe('route guard', () => {
  it('redirects anonymous users away from protected routes', async () => {
    const response = await proxy(request('/dashboard'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://app.example.com/login');
  });

  it('lets a valid access token through', async () => {
    const token = await new SignJWT({ role: 'user' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('1')
      .sign(KEY);
    const response = await proxy(request('/editor', { vc_access: token }));
    expect(response.status).toBe(200);
  });

  it('rejects a tampered access token without a refresh cookie', async () => {
    const response = await proxy(request('/projects', { vc_access: 'not-a-jwt' }));
    expect(response.headers.get('location')).toBe('https://app.example.com/login');
  });

  it('allows a refresh cookie to recover an expired session', async () => {
    const response = await proxy(request('/usage', { vc_refresh: 'opaque-refresh-token' }));
    expect(response.status).toBe(200);
  });

  it('redirects signed-in users away from the login page', async () => {
    const token = await new SignJWT({ role: 'user' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('1')
      .sign(KEY);
    const response = await proxy(request('/login', { vc_access: token }));
    expect(response.headers.get('location')).toBe('https://app.example.com/dashboard');
  });

  it('leaves public pages alone', async () => {
    expect((await proxy(request('/forgot-password'))).status).toBe(200);
  });
});
