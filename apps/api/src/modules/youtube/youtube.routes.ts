import { Router } from 'express';
import { env } from '../../config/env.js';
import { AppError } from '../../http/errors.js';
import { sendOk } from '../../http/respond.js';
import { readCookie } from '../auth/auth.cookies.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { createUploadSchema, idParamSchema, oauthCallbackSchema } from './youtube.schemas.js';
import * as service from './youtube.service.js';

const STATE_COOKIE = 'vc_yt_state';
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

function stateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: STATE_MAX_AGE_MS,
  };
}

function redirectToApp(result: 'connected' | string): string {
  const query = result === 'connected' ? 'connected=1' : `error=${encodeURIComponent(result)}`;
  return `${env.APP_URL}/youtube?${query}`;
}

export const youtubeRouter = Router();

/** Browser entry point for Google OAuth. State is bound to the browser via an httpOnly cookie. */
youtubeRouter.get('/oauth/connect', requireAuth, (req, res) => {
  const state = service.generateState();
  res.cookie(STATE_COOKIE, state, stateCookieOptions());
  res.redirect(service.buildAuthUrl(state));
});

/** Google redirects the browser here; the auth cookie (same host) identifies the user. */
youtubeRouter.get('/oauth/callback', requireAuth, async (req, res) => {
  const parsed = oauthCallbackSchema.safeParse(req.query);
  const fail = (code: string) => res.redirect(redirectToApp(code));

  res.clearCookie(STATE_COOKIE, { path: '/' });
  if (!parsed.success || parsed.data.error) return fail('oauth_denied');
  if (!parsed.data.code) return fail('invalid_callback');

  const expected = readCookie(req, STATE_COOKIE);
  if (!expected || expected !== parsed.data.state) return fail('invalid_state');

  try {
    await service.handleCallback(req.user!.id, parsed.data.code);
    res.redirect(redirectToApp('connected'));
  } catch (error) {
    fail(error instanceof AppError ? error.code : 'oauth_failed');
  }
});

youtubeRouter.use(requireAuth);

youtubeRouter.get('/account', async (req, res) => {
  sendOk(res, { account: await service.account(req.user!.id) });
});

youtubeRouter.post('/disconnect', async (req, res) => {
  sendOk(res, await service.disconnect(req.user!.id));
});

youtubeRouter.get('/state', (req, res) => {
  sendOk(res, service.state(req.user!.id));
});

youtubeRouter.post('/uploads', async (req, res) => {
  const input = createUploadSchema.parse(req.body);
  sendOk(res, await service.createUpload(req.user!.id, input), 202);
});

youtubeRouter.get('/uploads/:id', (req, res) => {
  sendOk(res, service.getUpload(req.user!.id, idParamSchema.parse(req.params).id));
});

youtubeRouter.post('/uploads/:id/retry', async (req, res) => {
  sendOk(res, await service.retryUpload(req.user!.id, idParamSchema.parse(req.params).id), 202);
});
