import { z } from 'zod';

const email = z.email({ error: 'Enter a valid email address' }).trim().toLowerCase().max(255);

const newPassword = z
  .string({ error: 'Enter a password' })
  .min(10, { error: 'Use at least 10 characters' })
  .max(128, { error: 'Use at most 128 characters' })
  .regex(/[A-Za-z]/, { error: 'Include at least one letter' })
  .regex(/[0-9]/, { error: 'Include at least one number' });

const token = z.string().regex(/^[a-f0-9]{64}$/, { error: 'Invalid token' });

export const registerSchema = z.object({
  email,
  displayName: z
    .string({ error: 'Enter a display name' })
    .trim()
    .min(2, { error: 'Use at least 2 characters' })
    .max(120, { error: 'Use at most 120 characters' }),
  password: newPassword,
});

export const loginSchema = z.object({
  email,
  password: z.string({ error: 'Enter your password' }).min(1).max(128),
});

export const updateProfileSchema = z.object({
  displayName: z
    .string({ error: 'Enter a display name' })
    .trim()
    .min(2, { error: 'Use at least 2 characters' })
    .max(120, { error: 'Use at most 120 characters' }),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string({ error: 'Enter your current password' }).min(1).max(128),
  newPassword,
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({ token, password: newPassword });

export const verifyEmailSchema = z.object({ token });

export const listUsersSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ListUsersInput = z.infer<typeof listUsersSchema>;
