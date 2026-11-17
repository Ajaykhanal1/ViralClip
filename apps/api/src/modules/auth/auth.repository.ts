import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { UserRole } from '@viralclip/shared';
import { pool } from '../../db/mysql.js';

export interface UserRow {
  id: number;
  email: string;
  displayName: string;
  passwordHash: string;
  role: UserRole;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

export interface VerificationTokenRow {
  id: number;
  userId: number;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface RefreshTokenRow {
  id: number;
  userId: number;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface AuthRepository {
  findUserByEmail(email: string): Promise<UserRow | null>;
  findUserById(id: number): Promise<UserRow | null>;
  createUser(input: { email: string; displayName: string; passwordHash: string }): Promise<UserRow>;
  updateDisplayName(id: number, displayName: string): Promise<UserRow | null>;
  updatePassword(id: number, passwordHash: string): Promise<void>;
  markEmailVerified(id: number): Promise<void>;
  listUsers(limit: number, offset: number): Promise<UserRow[]>;
  countUsers(): Promise<number>;

  createEmailVerification(userId: number, tokenHash: string, expiresAt: Date): Promise<void>;
  findEmailVerification(tokenHash: string): Promise<VerificationTokenRow | null>;
  markEmailVerificationUsed(id: number): Promise<void>;
  deleteEmailVerifications(userId: number): Promise<void>;

  createPasswordReset(userId: number, tokenHash: string, expiresAt: Date): Promise<void>;
  findPasswordReset(tokenHash: string): Promise<VerificationTokenRow | null>;
  markPasswordResetUsed(id: number): Promise<void>;
  deletePasswordResets(userId: number): Promise<void>;

  createRefreshToken(input: { userId: number; tokenHash: string; expiresAt: Date }): Promise<void>;
  findRefreshToken(tokenHash: string): Promise<RefreshTokenRow | null>;
  revokeRefreshToken(id: number): Promise<void>;
  revokeAllRefreshTokens(userId: number): Promise<void>;
}

interface UserDbRow extends RowDataPacket {
  id: number;
  email: string;
  display_name: string;
  password_hash: string;
  role: UserRole;
  email_verified_at: Date | null;
  created_at: Date;
}

interface VerificationDbRow extends RowDataPacket {
  id: number;
  user_id: number;
  expires_at: Date;
  used_at: Date | null;
}

interface RefreshDbRow extends RowDataPacket {
  id: number;
  user_id: number;
  expires_at: Date;
  revoked_at: Date | null;
}

const USER_COLUMNS = `id, email, display_name, password_hash, role, email_verified_at, created_at`;

function toUser(row: UserDbRow): UserRow {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    role: row.role,
    emailVerifiedAt: row.email_verified_at,
    createdAt: row.created_at,
  };
}

function toVerification(row: VerificationDbRow): VerificationTokenRow {
  return {
    id: row.id,
    userId: row.user_id,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
  };
}

async function findUser(where: 'id' | 'email', value: string | number): Promise<UserRow | null> {
  const [rows] = await pool.execute<UserDbRow[]>(
    `SELECT ${USER_COLUMNS} FROM users WHERE ${where} = ? LIMIT 1`,
    [value],
  );
  return rows[0] ? toUser(rows[0]) : null;
}

export const mysqlAuthRepository: AuthRepository = {
  findUserByEmail(email) {
    return findUser('email', email);
  },

  findUserById(id) {
    return findUser('id', id);
  },

  async createUser(input) {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?)`,
      [input.email, input.displayName, input.passwordHash],
    );
    const user = await findUser('id', result.insertId);
    if (!user) throw new Error(`User ${result.insertId} was inserted but could not be read back`);
    return user;
  },

  async updateDisplayName(id, displayName) {
    await pool.execute(`UPDATE users SET display_name = ? WHERE id = ?`, [displayName, id]);
    return findUser('id', id);
  },

  async updatePassword(id, passwordHash) {
    await pool.execute(`UPDATE users SET password_hash = ? WHERE id = ?`, [passwordHash, id]);
  },

  async markEmailVerified(id) {
    await pool.execute(
      `UPDATE users SET email_verified_at = CURRENT_TIMESTAMP
        WHERE id = ? AND email_verified_at IS NULL`,
      [id],
    );
  },

  async listUsers(limit, offset) {
    const [rows] = await pool.execute<UserDbRow[]>(
      `SELECT ${USER_COLUMNS} FROM users ORDER BY id LIMIT ? OFFSET ?`,
      [limit, offset],
    );
    return rows.map(toUser);
  },

  async countUsers() {
    const [rows] = await pool.execute<Array<RowDataPacket & { total: number }>>(
      `SELECT COUNT(*) AS total FROM users`,
    );
    return Number(rows[0]?.total ?? 0);
  },

  async createEmailVerification(userId, tokenHash, expiresAt) {
    await pool.execute(
      `INSERT INTO email_verifications (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
      [userId, tokenHash, expiresAt],
    );
  },

  async findEmailVerification(tokenHash) {
    const [rows] = await pool.execute<VerificationDbRow[]>(
      `SELECT id, user_id, expires_at, used_at FROM email_verifications
        WHERE token_hash = ? LIMIT 1`,
      [tokenHash],
    );
    return rows[0] ? toVerification(rows[0]) : null;
  },

  async markEmailVerificationUsed(id) {
    await pool.execute(`UPDATE email_verifications SET used_at = CURRENT_TIMESTAMP WHERE id = ?`, [
      id,
    ]);
  },

  async deleteEmailVerifications(userId) {
    await pool.execute(`DELETE FROM email_verifications WHERE user_id = ?`, [userId]);
  },

  async createPasswordReset(userId, tokenHash, expiresAt) {
    await pool.execute(
      `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
      [userId, tokenHash, expiresAt],
    );
  },

  async findPasswordReset(tokenHash) {
    const [rows] = await pool.execute<VerificationDbRow[]>(
      `SELECT id, user_id, expires_at, used_at FROM password_resets
        WHERE token_hash = ? LIMIT 1`,
      [tokenHash],
    );
    return rows[0] ? toVerification(rows[0]) : null;
  },

  async markPasswordResetUsed(id) {
    await pool.execute(`UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
  },

  async deletePasswordResets(userId) {
    await pool.execute(`DELETE FROM password_resets WHERE user_id = ?`, [userId]);
  },

  async createRefreshToken(input) {
    await pool.execute(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
      [input.userId, input.tokenHash, input.expiresAt],
    );
  },

  async findRefreshToken(tokenHash) {
    const [rows] = await pool.execute<RefreshDbRow[]>(
      `SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens
        WHERE token_hash = ? LIMIT 1`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    };
  },

  async revokeRefreshToken(id) {
    await pool.execute(
      `UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP
        WHERE id = ? AND revoked_at IS NULL`,
      [id],
    );
  },

  async revokeAllRefreshTokens(userId) {
    await pool.execute(
      `UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND revoked_at IS NULL`,
      [userId],
    );
  },
};
