import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthPanel } from '@/components/auth/auth-panel';
import { VerifyEmailPanel } from '@/components/auth/verify-email-panel';

export const metadata: Metadata = { title: 'Verify email - ViralClip AI' };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <AuthPanel
      title="Confirm your email"
      description="This verification link works once and expires after 24 hours."
      footer={
        <Link href="/login" className="font-medium text-accent underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      <VerifyEmailPanel token={token ?? ''} />
    </AuthPanel>
  );
}
