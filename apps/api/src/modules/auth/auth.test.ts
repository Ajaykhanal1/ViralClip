import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { AUTH_COOKIE_NAMES } from '@viralclip/shared';
import { logger } from '../../config/logger.js';
import { errorHandler } from '../../http/errors.js';
import { sendOk } from '../../http/respond.js';
import type { Mailer } from './auth.mailer.js';
import { requireAuth, requireRole } from './auth.middleware.js';
import type {
  AuthRepository,
  RefreshTokenRow,
  UserRow,
  VerificationTokenRow,
} from './auth.repository.js';
import { createAuthRouter } from './auth.routes.js';
import { signAccessToken } from './auth.security.js';

logger.level = 'silent';

type VerificationRecord = VerificationTokenRow & { tokenHash: string };

interface TestUser {
  id: number;
  email: string;
  displayName: string;
  role: string;
  emailVerified: boolean;
  createdAt: string;
}

interface TestBody {
  success: boolean;
  data: {
    user: TestUser;
    message?: string;
    allowed?: boolean;
    userId?: number;
  };
  error: { code: string; message: string; details?: unknown };
}

class MemoryAuthRepository implements AuthRepository {
  readonly users = new Map<number, UserRow>();
  readonly emailVerifications: VerificationRecord[] = [];
  readonly passwordResets: VerificationRecord[] = [];
  readonly refreshTokens: Array<RefreshTokenRow & { tokenHash: string }> = [];
  private nextUserId = 1;
  private nextTokenId = 1;

  async findUserByEmail(email: string): Promise<UserRow | null> {
    for (const user of this.users.values()) {
      if (user.email.toLowerCase() === email.toLowerCase()) return user;
    }
    return null;
  }

  async findUserById(id: number): Promise<UserRow | null> {
    return this.users.get(id) ?? null;
  }

  async createUser(input: {
    email: string;
    displayName: string;
    passwordHash: string;
  }): Promise<UserRow> {
    if (await this.findUserByEmail(input.email)) {
      throw Object.assign(new Error('duplicate email'), { code: 'ER_DUP_ENTRY' });
    }
    const user: UserRow = {
      id: this.nextUserId++,
      email: input.email,
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      role: 'user',
      emailVerifiedAt: null,
      createdAt: new Date(),
    };
    this.users.set(user.id, user);
    return { ...user };
  }

  async updateDisplayName(id: number, displayName: string): Promise<UserRow | null> {
    const user = this.users.get(id);
    if (!user) return null;
    user.displayName = displayName;
    return { ...user };
  }

  async updatePassword(id: number, passwordHash: string): Promise<void> {
    const user = this.users.get(id);
    if (user) user.passwordHash = passwordHash;
  }

  async markEmailVerified(id: number): Promise<void> {
    const user = this.users.get(id);
    if (user && !user.emailVerifiedAt) user.emailVerifiedAt = new Date();
  }

  async listUsers(limit: number, offset: number): Promise<UserRow[]> {
    return [...this.users.values()].slice(offset, offset + limit).map((user) => ({ ...user }));
  }

  async countUsers(): Promise<number> {
    return this.users.size;
  }

  async createEmailVerification(userId: number, tokenHash: string, expiresAt: Date): Promise<void> {
    this.emailVerifications.push({
      id: this.nextTokenId++,
      userId,
      tokenHash,
      expiresAt,
      usedAt: null,
    });
  }

  async findEmailVerification(tokenHash: string): Promise<VerificationTokenRow | null> {
    return this.emailVerifications.find((row) => row.tokenHash === tokenHash) ?? null;
  }

  async markEmailVerificationUsed(id: number): Promise<void> {
    const row = this.emailVerifications.find((candidate) => candidate.id === id);
    if (row) row.usedAt = new Date();
  }

  async deleteEmailVerifications(userId: number): Promise<void> {
    for (let index = this.emailVerifications.length - 1; index >= 0; index--) {
      if (this.emailVerifications[index]?.userId === userId)
        this.emailVerifications.splice(index, 1);
    }
  }

  async createPasswordReset(userId: number, tokenHash: string, expiresAt: Date): Promise<void> {
    this.passwordResets.push({
      id: this.nextTokenId++,
      userId,
      tokenHash,
      expiresAt,
      usedAt: null,
    });
  }

  async findPasswordReset(tokenHash: string): Promise<VerificationTokenRow | null> {
    return this.passwordResets.find((row) => row.tokenHash === tokenHash) ?? null;
  }

  async markPasswordResetUsed(id: number): Promise<void> {
    const row = this.passwordResets.find((candidate) => candidate.id === id);
    if (row) row.usedAt = new Date();
  }

  async deletePasswordResets(userId: number): Promise<void> {
    for (let index = this.passwordResets.length - 1; index >= 0; index--) {
      if (this.passwordResets[index]?.userId === userId) this.passwordResets.splice(index, 1);
    }
  }

  async createRefreshToken(input: {
    userId: number;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    this.refreshTokens.push({
      id: this.nextTokenId++,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null,
    });
  }

  async findRefreshToken(tokenHash: string): Promise<RefreshTokenRow | null> {
    return this.refreshTokens.find((row) => row.tokenHash === tokenHash) ?? null;
  }

  async revokeRefreshToken(id: number): Promise<void> {
    const row = this.refreshTokens.find((candidate) => candidate.id === id);
    if (row && !row.revokedAt) row.revokedAt = new Date();
  }

  async revokeAllRefreshTokens(userId: number): Promise<void> {
    for (const row of this.refreshTokens) {
      if (row.userId === userId && !row.revokedAt) row.revokedAt = new Date();
    }
  }
}

class FakeMailer implements Mailer {
  readonly verification = new Map<string, string>();
  readonly resets = new Map<string, string>();

  async sendVerification(to: string, token: string): Promise<void> {
    this.verification.set(to, token);
  }

  async sendPasswordReset(to: string, token: string): Promise<void> {
    this.resets.set(to, token);
  }
}

function buildApp(repo: AuthRepository, mailer: Mailer, rateLimit = false): express.Express {
  const app = express();
  app.use(express.json());

  const api = express.Router();
  api.use('/auth', createAuthRouter({ repo, mailer, rateLimit }));
  api.get('/protected', requireAuth, (req, res) => {
    sendOk(res, { userId: req.user!.id, role: req.user!.role });
  });
  api.get('/admin', requireAuth, requireRole('admin'), (_req, res) => {
    sendOk(res, { allowed: true });
  });

  app.use('/api/v1', api);
  app.use(errorHandler);
  return app;
}

async function withServer(t: test.TestContext, app: express.Express): Promise<string> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

interface CallOptions {
  method?: string;
  body?: unknown;
  cookie?: string;
}

async function call(base: string, path: string, options: CallOptions = {}) {
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const body = (await response.json()) as TestBody;
  const setCookie = response.headers.getSetCookie();
  const cookie = setCookie
    .filter((value) => !value.includes('Expires=Thu, 01 Jan 1970'))
    .map((value) => value.split(';')[0])
    .join('; ');

  return { response, body, setCookie, cookie };
}

const PASSWORD = 'correct-horse-9';

async function register(base: string, email = 'ada@example.com') {
  return call(base, '/api/v1/auth/register', {
    method: 'POST',
    body: { email, displayName: 'Ada Lovelace', password: PASSWORD },
  });
}

function setup(t: test.TestContext, rateLimit = false) {
  const repo = new MemoryAuthRepository();
  const mailer = new FakeMailer();
  return { repo, mailer, app: buildApp(repo, mailer, rateLimit) };
}

test('registration creates a user, sets HTTP-only cookies, and hides the password hash', async (t) => {
  const { app } = setup(t);
  const base = await withServer(t, app);

  const result = await register(base);

  assert.equal(result.response.status, 201);
  assert.equal(result.body.data.user.email, 'ada@example.com');
  assert.equal(result.body.data.user.role, 'user');
  assert.equal(result.body.data.user.emailVerified, false);
  assert.equal('passwordHash' in result.body.data.user, false);
  assert.equal('password_hash' in result.body.data.user, false);
  assert.match(result.cookie, new RegExp(`${AUTH_COOKIE_NAMES.access}=.+`));
  assert.match(result.cookie, new RegExp(`${AUTH_COOKIE_NAMES.refresh}=.+`));
  assert.ok(result.setCookie.some((value) => value.includes('HttpOnly')));

  const me = await call(base, '/api/v1/auth/me', { cookie: result.cookie });
  assert.equal(me.response.status, 200);
  assert.equal(me.body.data.user.id, result.body.data.user.id);
});

test('duplicate email registration is rejected case-insensitively', async (t) => {
  const { app } = setup(t);
  const base = await withServer(t, app);

  await register(base, 'ada@example.com');
  const duplicate = await register(base, 'ADA@example.com');

  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.error.code, 'EMAIL_TAKEN');
});

test('login accepts the right password and rejects wrong or unknown credentials', async (t) => {
  const { app } = setup(t);
  const base = await withServer(t, app);
  await register(base);

  const wrong = await call(base, '/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'ada@example.com', password: 'wrong-password-1' },
  });
  assert.equal(wrong.response.status, 401);
  assert.equal(wrong.body.error.code, 'INVALID_CREDENTIALS');

  const unknown = await call(base, '/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'nobody@example.com', password: PASSWORD },
  });
  assert.equal(unknown.response.status, 401);
  assert.equal(unknown.body.error.code, 'INVALID_CREDENTIALS');

  const login = await call(base, '/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'ada@example.com', password: PASSWORD },
  });
  assert.equal(login.response.status, 200);
  assert.match(login.cookie, new RegExp(`${AUTH_COOKIE_NAMES.refresh}=.+`));
});

test('logout revokes the refresh token and clears cookies', async (t) => {
  const { app } = setup(t);
  const base = await withServer(t, app);
  const registered = await register(base);

  const loggedOut = await call(base, '/api/v1/auth/logout', {
    method: 'POST',
    cookie: registered.cookie,
  });
  assert.equal(loggedOut.response.status, 200);
  assert.ok(loggedOut.setCookie.some((value) => value.includes('Expires=Thu, 01 Jan 1970')));

  const refreshed = await call(base, '/api/v1/auth/refresh', {
    method: 'POST',
    cookie: registered.cookie,
  });
  assert.equal(refreshed.response.status, 401);
  assert.equal(refreshed.body.error.code, 'INVALID_REFRESH_TOKEN');
});

test('refresh rotates tokens and reusing an old token revokes the session', async (t) => {
  const { app } = setup(t);
  const base = await withServer(t, app);
  const registered = await register(base);

  const refreshed = await call(base, '/api/v1/auth/refresh', {
    method: 'POST',
    cookie: registered.cookie,
  });
  assert.equal(refreshed.response.status, 200);
  assert.notEqual(
    refreshed.cookie.match(new RegExp(`${AUTH_COOKIE_NAMES.refresh}=([^;]+)`))?.[1],
    registered.cookie.match(new RegExp(`${AUTH_COOKIE_NAMES.refresh}=([^;]+)`))?.[1],
  );

  const reused = await call(base, '/api/v1/auth/refresh', {
    method: 'POST',
    cookie: registered.cookie,
  });
  assert.equal(reused.response.status, 401);

  const afterReuse = await call(base, '/api/v1/auth/refresh', {
    method: 'POST',
    cookie: refreshed.cookie,
  });
  assert.equal(afterReuse.response.status, 401);
});

test('protected routes reject missing, expired, and tampered access tokens', async (t) => {
  const { app } = setup(t);
  const base = await withServer(t, app);
  const registered = await register(base);
  const userId = registered.body.data.user.id as number;

  const missing = await call(base, '/api/v1/protected');
  assert.equal(missing.response.status, 401);

  const expiredToken = await signAccessToken({ id: userId, role: 'user' }, -10);
  const expired = await call(base, '/api/v1/protected', {
    cookie: `${AUTH_COOKIE_NAMES.access}=${expiredToken}`,
  });
  assert.equal(expired.response.status, 401);

  const tampered = await call(base, '/api/v1/protected', {
    cookie: `${AUTH_COOKIE_NAMES.access}=${expiredToken}tampered`,
  });
  assert.equal(tampered.response.status, 401);

  const allowed = await call(base, '/api/v1/protected', { cookie: registered.cookie });
  assert.equal(allowed.response.status, 200);
  assert.equal(allowed.body.data.userId, userId);

  const refreshed = await call(base, '/api/v1/auth/refresh', {
    method: 'POST',
    cookie: registered.cookie,
  });
  assert.equal(refreshed.response.status, 200);
});

test('admin routes are limited to the admin role', async (t) => {
  const { app, repo } = setup(t);
  const base = await withServer(t, app);
  const registered = await register(base);
  const userId = registered.body.data.user.id;

  const denied = await call(base, '/api/v1/admin', { cookie: registered.cookie });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.body.error.code, 'FORBIDDEN');

  const user = repo.users.get(userId);
  assert.ok(user);
  user.role = 'admin';

  const login = await call(base, '/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'ada@example.com', password: PASSWORD },
  });
  assert.equal(login.response.status, 200);

  const allowed = await call(base, '/api/v1/admin', { cookie: login.cookie });
  assert.equal(allowed.response.status, 200);
  assert.equal(allowed.body.data.allowed, true);
});

test('password reset rotates the password, revokes sessions, and is single-use', async (t) => {
  const { app, mailer } = setup(t);
  const base = await withServer(t, app);
  const registered = await register(base);

  const requested = await call(base, '/api/v1/auth/forgot-password', {
    method: 'POST',
    body: { email: 'ada@example.com' },
  });
  assert.equal(requested.response.status, 202);

  const token = mailer.resets.get('ada@example.com');
  assert.ok(token);

  const reset = await call(base, '/api/v1/auth/reset-password', {
    method: 'POST',
    body: { token, password: 'new-password-42' },
  });
  assert.equal(reset.response.status, 200);

  const oldLogin = await call(base, '/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'ada@example.com', password: PASSWORD },
  });
  assert.equal(oldLogin.response.status, 401);

  const newLogin = await call(base, '/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'ada@example.com', password: 'new-password-42' },
  });
  assert.equal(newLogin.response.status, 200);

  const oldSession = await call(base, '/api/v1/auth/refresh', {
    method: 'POST',
    cookie: registered.cookie,
  });
  assert.equal(oldSession.response.status, 401);

  const reused = await call(base, '/api/v1/auth/reset-password', {
    method: 'POST',
    body: { token, password: 'another-password-7' },
  });
  assert.equal(reused.response.status, 400);
  assert.equal(reused.body.error.code, 'INVALID_RESET_TOKEN');
});

test('expired password reset tokens are rejected', async (t) => {
  const { app, mailer, repo } = setup(t);
  const base = await withServer(t, app);
  await register(base);

  await call(base, '/api/v1/auth/forgot-password', {
    method: 'POST',
    body: { email: 'ada@example.com' },
  });

  const row = repo.passwordResets[0];
  const token = mailer.resets.get('ada@example.com');
  assert.ok(row);
  assert.ok(token);
  row.expiresAt = new Date(Date.now() - 1000);

  const reset = await call(base, '/api/v1/auth/reset-password', {
    method: 'POST',
    body: { token, password: 'new-password-42' },
  });
  assert.equal(reset.response.status, 400);
  assert.equal(reset.body.error.code, 'INVALID_RESET_TOKEN');
});

test('forgot-password does not reveal whether an account exists', async (t) => {
  const { app, mailer } = setup(t);
  const base = await withServer(t, app);

  const result = await call(base, '/api/v1/auth/forgot-password', {
    method: 'POST',
    body: { email: 'nobody@example.com' },
  });
  assert.equal(result.response.status, 202);
  assert.equal(result.body.success, true);
  assert.equal(mailer.resets.size, 0);
});

test('email verification marks the account and consumes the token', async (t) => {
  const { app, mailer } = setup(t);
  const base = await withServer(t, app);
  const registered = await register(base);

  const token = mailer.verification.get('ada@example.com');
  assert.ok(token);

  const verified = await call(base, '/api/v1/auth/verify-email', {
    method: 'POST',
    body: { token },
  });
  assert.equal(verified.response.status, 200);
  assert.equal(verified.body.data.user.emailVerified, true);

  const reused = await call(base, '/api/v1/auth/verify-email', {
    method: 'POST',
    body: { token },
  });
  assert.equal(reused.response.status, 400);

  const resend = await call(base, '/api/v1/auth/resend-verification', {
    method: 'POST',
    cookie: registered.cookie,
  });
  assert.equal(resend.response.status, 409);
  assert.equal(resend.body.error.code, 'EMAIL_ALREADY_VERIFIED');
});

test('resend verification issues a fresh token for an unverified account', async (t) => {
  const { app, mailer } = setup(t);
  const base = await withServer(t, app);
  const registered = await register(base);
  const firstToken = mailer.verification.get('ada@example.com');

  const resend = await call(base, '/api/v1/auth/resend-verification', {
    method: 'POST',
    cookie: registered.cookie,
  });
  assert.equal(resend.response.status, 202);

  const secondToken = mailer.verification.get('ada@example.com');
  assert.ok(secondToken);
  assert.notEqual(secondToken, firstToken);

  const verified = await call(base, '/api/v1/auth/verify-email', {
    method: 'POST',
    body: { token: secondToken },
  });
  assert.equal(verified.response.status, 200);
  assert.equal(verified.body.data.user.emailVerified, true);
});

test('profile updates and validation are applied', async (t) => {
  const { app } = setup(t);
  const base = await withServer(t, app);
  const registered = await register(base);

  const updated = await call(base, '/api/v1/auth/me', {
    method: 'PATCH',
    cookie: registered.cookie,
    body: { displayName: 'Ada L.' },
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.data.user.displayName, 'Ada L.');

  const me = await call(base, '/api/v1/auth/me', { cookie: registered.cookie });
  assert.equal(me.body.data.user.displayName, 'Ada L.');

  const invalid = await call(base, '/api/v1/auth/me', {
    method: 'PATCH',
    cookie: registered.cookie,
    body: { displayName: '' },
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');
});

test('changing a password requires the current one and ends other sessions', async (t) => {
  const { app } = setup(t);
  const base = await withServer(t, app);
  const registered = await register(base);

  const wrong = await call(base, '/api/v1/auth/me/password', {
    method: 'PATCH',
    cookie: registered.cookie,
    body: { currentPassword: 'not-the-password-1', newPassword: 'new-password-42' },
  });
  assert.equal(wrong.response.status, 400);
  assert.equal(wrong.body.error.code, 'INVALID_CURRENT_PASSWORD');

  const changed = await call(base, '/api/v1/auth/me/password', {
    method: 'PATCH',
    cookie: registered.cookie,
    body: { currentPassword: PASSWORD, newPassword: 'new-password-42' },
  });
  assert.equal(changed.response.status, 200);

  const oldSession = await call(base, '/api/v1/auth/refresh', {
    method: 'POST',
    cookie: registered.cookie,
  });
  assert.equal(oldSession.response.status, 401);

  const oldLogin = await call(base, '/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'ada@example.com', password: PASSWORD },
  });
  assert.equal(oldLogin.response.status, 401);

  const newLogin = await call(base, '/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'ada@example.com', password: 'new-password-42' },
  });
  assert.equal(newLogin.response.status, 200);
});

test('registration is rate limited per client', async (t) => {
  const { app } = setup(t, true);
  const base = await withServer(t, app);

  for (let index = 0; index < 5; index++) {
    const allowed = await register(base, `user${index}@example.com`);
    assert.equal(allowed.response.status, 201);
  }

  const blocked = await register(base, 'blocked@example.com');
  assert.equal(blocked.response.status, 429);
  assert.equal(blocked.body.error.code, 'RATE_LIMITED');
});
