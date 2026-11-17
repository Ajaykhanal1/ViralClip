import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthPanel } from '@/components/auth/auth-panel';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';

export const metadata: Metadata = { title: 'Reset password - ViralClip AI' };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <AuthPanel
      title="Choose a new password"
      description="This reset link works once and expires after one hour."
      footer={
        <Link href="/login" className="font-medium text-accent underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      <ResetPasswordForm token={token ?? ''} />
    </AuthPanel>
  );
}
