import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthPanel } from '@/components/auth/auth-panel';
import { RegisterForm } from '@/components/auth/register-form';

export const metadata: Metadata = { title: 'Create account - ViralClip AI' };

export default function RegisterPage() {
  return (
    <AuthPanel
      title="Create account"
      description="Start with an account. Uploads and the clip pipeline are not open yet."
      footer={
        <>
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthPanel>
  );
}
