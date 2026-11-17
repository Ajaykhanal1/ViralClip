import { Router } from 'express';
import { AUTH_COOKIE_NAMES } from '@viralclip/shared';
import { AppError } from '../../http/errors.js';
import { sendOk } from '../../http/respond.js';
import { clearAuthCookies, readCookie, setAuthCookies } from './auth.cookies.js';
import { smtpMailer, type Mailer } from './auth.mailer.js';
import { requireAuth, requireRole } from './auth.middleware.js';
import { mysqlAuthRepository, type AuthRepository } from './auth.repository.js';
import { authRateLimiters } from './auth.rate-limit.js';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  listUsersSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from './auth.schemas.js';
import { AuthService } from './auth.service.js';

export interface AuthRouterOptions {
  repo?: AuthRepository;
  mailer?: Mailer;
  /** Disabled in tests so rate limits do not interfere with flow coverage. */
  rateLimit?: boolean;
}

export function createAuthRouter(options: AuthRouterOptions = {}): Router {
  const service = new AuthService(
    options.repo ?? mysqlAuthRepository,
    options.mailer ?? smtpMailer,
  );
  const limits = authRateLimiters(options.rateLimit !== false);
  const router = Router();

  router.post('/register', limits.register, async (req, res) => {
    const result = await service.register(registerSchema.parse(req.body));
    setAuthCookies(res, result.tokens);
    sendOk(res, { user: result.user }, 201);
  });

  router.post('/login', limits.login, async (req, res) => {
    const result = await service.login(loginSchema.parse(req.body));
    setAuthCookies(res, result.tokens);
    sendOk(res, { user: result.user });
  });

  router.post('/refresh', limits.refresh, async (req, res) => {
    try {
      const result = await service.refresh(readCookie(req, AUTH_COOKIE_NAMES.refresh));
      setAuthCookies(res, result.tokens);
      sendOk(res, { user: result.user });
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 401) clearAuthCookies(res);
      throw error;
    }
  });

  router.post('/logout', async (req, res) => {
    await service.logout(readCookie(req, AUTH_COOKIE_NAMES.refresh));
    clearAuthCookies(res);
    sendOk(res, { message: 'Signed out' });
  });

  router.get('/me', requireAuth, async (req, res) => {
    sendOk(res, { user: await service.me(req.user!.id) });
  });

  router.patch('/me', requireAuth, async (req, res) => {
    const input = updateProfileSchema.parse(req.body);
    sendOk(res, { user: await service.updateProfile(req.user!.id, input) });
  });

  router.patch('/me/password', requireAuth, async (req, res) => {
    await service.changePassword(req.user!.id, changePasswordSchema.parse(req.body));
    clearAuthCookies(res);
    sendOk(res, { message: 'Password updated. Sign in again with your new password.' });
  });

  router.post('/forgot-password', limits.forgotPassword, async (req, res) => {
    const input = forgotPasswordSchema.parse(req.body);
    await service.forgotPassword(input.email);
    sendOk(
      res,
      { message: 'If that email is registered, a password reset link is on its way.' },
      202,
    );
  });

  router.post('/reset-password', limits.resetPassword, async (req, res) => {
    await service.resetPassword(resetPasswordSchema.parse(req.body));
    clearAuthCookies(res);
    sendOk(res, { message: 'Password updated. Sign in with your new password.' });
  });

  router.post('/verify-email', limits.verifyEmail, async (req, res) => {
    const input = verifyEmailSchema.parse(req.body);
    sendOk(res, { user: await service.verifyEmail(input.token) });
  });

  router.post('/resend-verification', requireAuth, limits.resendVerification, async (req, res) => {
    await service.resendVerification(req.user!.id);
    sendOk(res, { message: 'Verification email sent.' }, 202);
  });

  router.get('/users', requireAuth, requireRole('admin'), async (req, res) => {
    sendOk(res, await service.listUsers(listUsersSchema.parse(req.query)));
  });

  return router;
}
