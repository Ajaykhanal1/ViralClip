import type { AuthUser } from '@viralclip/shared';
import { logger } from '../../config/logger.js';
import { AppError } from '../../http/errors.js';
import type { Mailer } from './auth.mailer.js';
import type { AuthRepository, UserRow } from './auth.repository.js';
import type {
  ChangePasswordInput,
  ListUsersInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  UpdateProfileInput,
} from './auth.schemas.js';
import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  REFRESH_TTL_MS,
  signAccessToken,
  verifyLoginPassword,
} from './auth.security.js';

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult {
  user: AuthUser;
  tokens: AuthTokens;
}

export function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    emailVerified: row.emailVerifiedAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

function isDuplicateEntry(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY'
  );
}

function invalidRefresh(status = 401): AppError {
  return new AppError(status, 'INVALID_REFRESH_TOKEN', 'Your session has ended. Sign in again.');
}

export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly mailer: Mailer,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async register(input: RegisterInput): Promise<AuthResult> {
    let user: UserRow;

    try {
      user = await this.repo.createUser({
        email: input.email,
        displayName: input.displayName,
        passwordHash: await hashPassword(input.password),
      });
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
      }
      throw error;
    }

    await this.sendVerification(user);
    return { user: toAuthUser(user), tokens: await this.issueSession(user) };
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await this.repo.findUserByEmail(input.email);
    const valid = await verifyLoginPassword(input.password, user?.passwordHash ?? null);

    if (!user || !valid) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    return { user: toAuthUser(user), tokens: await this.issueSession(user) };
  }

  async refresh(rawToken: string | undefined): Promise<AuthResult> {
    if (!rawToken) throw invalidRefresh();

    const row = await this.repo.findRefreshToken(hashOpaqueToken(rawToken));
    if (!row) throw invalidRefresh();

    if (row.revokedAt) {
      // Reusing a rotated token is a theft signal: end every session for the account.
      await this.repo.revokeAllRefreshTokens(row.userId);
      throw invalidRefresh();
    }

    if (row.expiresAt.getTime() <= this.now().getTime()) {
      await this.repo.revokeRefreshToken(row.id);
      throw new AppError(401, 'REFRESH_TOKEN_EXPIRED', 'Your session expired. Sign in again.');
    }

    const user = await this.repo.findUserById(row.userId);
    if (!user) {
      await this.repo.revokeRefreshToken(row.id);
      throw invalidRefresh();
    }

    await this.repo.revokeRefreshToken(row.id);
    return { user: toAuthUser(user), tokens: await this.issueSession(user) };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;

    const row = await this.repo.findRefreshToken(hashOpaqueToken(rawToken));
    if (row && !row.revokedAt) await this.repo.revokeRefreshToken(row.id);
  }

  async me(userId: number): Promise<AuthUser> {
    const user = await this.repo.findUserById(userId);
    if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
    return toAuthUser(user);
  }

  async updateProfile(userId: number, input: UpdateProfileInput): Promise<AuthUser> {
    const user = await this.repo.updateDisplayName(userId, input.displayName);
    if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
    return toAuthUser(user);
  }

  async changePassword(userId: number, input: ChangePasswordInput): Promise<void> {
    const user = await this.repo.findUserById(userId);
    if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');

    if (!(await verifyLoginPassword(input.currentPassword, user.passwordHash))) {
      throw new AppError(400, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect');
    }

    await this.repo.updatePassword(user.id, await hashPassword(input.newPassword));
    await this.repo.revokeAllRefreshTokens(user.id);
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.repo.findUserByEmail(email);
    if (!user) return;

    const token = createOpaqueToken();
    await this.repo.deletePasswordResets(user.id);
    await this.repo.createPasswordReset(
      user.id,
      hashOpaqueToken(token),
      new Date(this.now().getTime() + PASSWORD_RESET_TTL_MS),
    );

    try {
      await this.mailer.sendPasswordReset(user.email, token);
    } catch (error) {
      logger.error({ err: error, userId: user.id }, 'failed to send password reset email');
    }
  }

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const row = await this.repo.findPasswordReset(hashOpaqueToken(input.token));

    if (!row || row.usedAt || row.expiresAt.getTime() <= this.now().getTime()) {
      throw new AppError(400, 'INVALID_RESET_TOKEN', 'This reset link is invalid or has expired');
    }

    const user = await this.repo.findUserById(row.userId);
    if (!user)
      throw new AppError(400, 'INVALID_RESET_TOKEN', 'This reset link is invalid or has expired');

    await this.repo.updatePassword(user.id, await hashPassword(input.password));
    await this.repo.markPasswordResetUsed(row.id);
    await this.repo.deletePasswordResets(user.id);
    await this.repo.revokeAllRefreshTokens(user.id);
  }

  async verifyEmail(rawToken: string): Promise<AuthUser> {
    const row = await this.repo.findEmailVerification(hashOpaqueToken(rawToken));

    if (!row || row.usedAt || row.expiresAt.getTime() <= this.now().getTime()) {
      throw new AppError(
        400,
        'INVALID_VERIFICATION_TOKEN',
        'This verification link is invalid or has expired',
      );
    }

    const user = await this.repo.findUserById(row.userId);
    if (!user) {
      throw new AppError(
        400,
        'INVALID_VERIFICATION_TOKEN',
        'This verification link is invalid or has expired',
      );
    }

    await this.repo.markEmailVerified(user.id);
    await this.repo.markEmailVerificationUsed(row.id);
    await this.repo.deleteEmailVerifications(user.id);

    return toAuthUser((await this.repo.findUserById(user.id)) ?? user);
  }

  async resendVerification(userId: number): Promise<void> {
    const user = await this.repo.findUserById(userId);
    if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
    if (user.emailVerifiedAt) {
      throw new AppError(409, 'EMAIL_ALREADY_VERIFIED', 'This email is already verified');
    }
    await this.sendVerification(user);
  }

  async listUsers(
    input: ListUsersInput,
  ): Promise<{ users: AuthUser[]; total: number; limit: number; offset: number }> {
    const [users, total] = await Promise.all([
      this.repo.listUsers(input.limit, input.offset),
      this.repo.countUsers(),
    ]);
    return { users: users.map(toAuthUser), total, limit: input.limit, offset: input.offset };
  }

  private async issueSession(user: UserRow): Promise<AuthTokens> {
    const refreshToken = createOpaqueToken();
    await this.repo.createRefreshToken({
      userId: user.id,
      tokenHash: hashOpaqueToken(refreshToken),
      expiresAt: new Date(this.now().getTime() + REFRESH_TTL_MS),
    });

    return {
      accessToken: await signAccessToken({ id: user.id, role: user.role }),
      refreshToken,
    };
  }

  private async sendVerification(user: UserRow): Promise<void> {
    const token = createOpaqueToken();
    await this.repo.deleteEmailVerifications(user.id);
    await this.repo.createEmailVerification(
      user.id,
      hashOpaqueToken(token),
      new Date(this.now().getTime() + VERIFICATION_TTL_MS),
    );

    try {
      await this.mailer.sendVerification(user.email, token);
    } catch (error) {
      logger.error({ err: error, userId: user.id }, 'failed to send verification email');
    }
  }
}
