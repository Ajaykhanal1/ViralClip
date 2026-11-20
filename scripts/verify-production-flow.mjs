import assert from 'node:assert/strict';

const baseUrl = (process.env.BASE_URL ?? 'https://localhost').replace(/\/$/, '');
const email = `smoke-${Date.now()}@example.invalid`;
const password = 'SmokeTest123!';
const cookies = new Map();

async function request(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (cookies.size) headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers, redirect: 'manual' });
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const separator = pair.indexOf('=');
    if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  return response;
}

function expect(condition, message) {
  assert.ok(condition, message);
}

async function json(response) {
  const body = await response.json().catch(() => null);
  expect(response.ok, `${response.status} ${response.statusText}: ${JSON.stringify(body)}`);
  return body;
}

const liveness = await json(await request('/health'));
expect(liveness?.status === 'ok' || liveness?.success === true, 'API liveness failed');

const ready = await json(await request('/api/v1/health/ready'));
expect(ready?.data?.checks?.mysql?.status === 'up', 'MySQL readiness failed');
expect(ready?.data?.checks?.redis?.status === 'up', 'Redis readiness failed');

const webHealth = await json(await request('/web-health'));
expect(webHealth?.status === 'ok', 'Web health failed');

const registered = await json(
  await request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, displayName: 'Smoke Test', password }),
  }),
);
expect(registered?.success === true, 'Registration failed');

const me = await json(await request('/api/v1/auth/me'));
expect(me?.data?.email === email, 'Authenticated session failed');

await json(await request('/api/v1/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));

console.log('production flow verification passed');
