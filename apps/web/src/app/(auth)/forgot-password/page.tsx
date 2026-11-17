import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthPanel } from '@/components/auth/auth-panel';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';

export const metadata: Metadata = { title: 'Forgot password - ViralClip AI' };

export default function ForgotPasswordPage() {
  return (
    <AuthPanel
      title="Forgot password"
      description="Enter your email and we will send a link to choose a new password."
      footer={
        <>
          Remembered it?{' '}
          <Link
            href="/login"
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            Back to sign in
          </Link>
        </>
      }
    >
      <ForgotPasswordForm />
    </AuthPanel>
  );
}
