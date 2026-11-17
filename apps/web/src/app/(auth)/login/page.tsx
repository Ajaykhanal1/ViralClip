import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthPanel } from '@/components/auth/auth-panel';
import { LoginForm } from '@/components/auth/login-form';

export const metadata: Metadata = { title: 'Sign in - ViralClip AI' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ changed?: string }>;
}) {
  const { changed } = await searchParams;

  return (
    <AuthPanel
      title="Sign in"
      description="Pick up where the last cut left off."
      footer={
        <>
          New here?{' '}
          <Link
            href="/register"
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm
        notice={
          changed === '1' ? 'Your password changed. Sign in with your new password.' : undefined
        }
      />
    </AuthPanel>
  );
}
