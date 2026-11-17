'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuthStore } from '@/store/auth-store';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((state) => state.status);
  const hydrate = useAuthStore((state) => state.hydrate);
  const router = useRouter();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (status === 'guest') router.replace('/login');
  }, [status, router]);

  if (status === 'authenticated') return <>{children}</>;

  return (
    <div
      aria-live="polite"
      className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center text-center"
    >
      <p className="font-mono text-xs text-ink-soft">
        {status === 'guest' ? 'Redirecting to sign in' : 'Checking your session'}
      </p>
      <div className="sprockets mt-4 h-3 w-40" aria-hidden="true" />
    </div>
  );
}
