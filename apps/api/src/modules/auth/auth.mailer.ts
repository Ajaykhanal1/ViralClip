import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

export interface Mailer {
  sendVerification(to: string, token: string): Promise<void>;
  sendPasswordReset(to: string, token: string): Promise<void>;
}

export function verificationUrl(token: string): string {
  return `${env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
}

export function passwordResetUrl(token: string): string {
  return `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
}

let transport: Transporter | undefined;

function getTransport(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
  });
  return transport;
}

async function send(to: string, subject: string, text: string): Promise<void> {
  const sender = getTransport();

  if (!sender) {
    if (env.NODE_ENV === 'production') {
      // shortcut: no SMTP in production means no email delivery; configure SMTP_HOST before launch.
      logger.error({ to }, 'SMTP is not configured; email was not sent');
      return;
    }
    logger.info({ to, subject, text }, 'email not sent (development): link follows');
    return;
  }

  await sender.sendMail({ from: env.SMTP_FROM, to, subject, text });
}

/** Reused by notification emails so dev-mode logging and SMTP config stay in one place. */
export async function sendNotificationEmail(to: string, subject: string, text: string): Promise<void> {
  await send(to, subject, text);
}

export const smtpMailer: Mailer = {
  async sendVerification(to, token) {
    await send(
      to,
      'Verify your ViralClip AI email',
      `Confirm your email address to finish setting up your account:\n\n${verificationUrl(token)}\n\nThis link expires in 24 hours.`,
    );
  },

  async sendPasswordReset(to, token) {
    await send(
      to,
      'Reset your ViralClip AI password',
      `Use this link to choose a new password:\n\n${passwordResetUrl(token)}\n\nThis link expires in 1 hour. If you did not request it, ignore this email.`,
    );
  },
};
