'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { AuthUser } from '@viralclip/shared';
import { errorMessage, verifyEmail } from '@/lib/auth-api';
import { useAuthStore } from '@/store/auth-store';
import { FormMessage } from '@/components/ui/form-message';

type State =
  | { status: 'pending' }
  | { status: 'success'; user: AuthUser }
  | { status: 'error'; message: string };

export function VerifyEmailPanel({ token }: { token: string }) {
  const [state, setState] = useState<State>({ status: 'pending' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (!token) {
      setState({ status: 'error', message: 'This verification link is incomplete.' });
      return;
    }

    verifyEmail({ token })
      .then(({ user }) => {
        // Refresh the session user only when this browser already owns that account.
        if (useAuthStore.getState().user?.id === user.id) useAuthStore.setState({ user });
        setState({ status: 'success', user });
      })
      .catch((caught: unknown) => setState({ status: 'error', message: errorMessage(caught) }));
  }, [token]);

  if (state.status === 'pending') {
    return (
      <div aria-live="polite" className="space-y-4">
        <p className="text-sm text-ink-soft">Checking your verification link…</p>
        <div className="sprockets h-3" aria-hidden="true" />
      </div>
    );
  }

  if (state.status === 'success') {
    return (
      <div className="space-y-5">
        <FormMessage tone="success">
          Email confirmed for {state.user.email}. Your account is ready.
        </FormMessage>
        <Link
          href="/settings/profile"
          className="inline-flex w-full items-center justify-center bg-ink px-4 py-3 text-sm font-semibold text-paper transition-colors hover:bg-accent"
        >
          Open account settings
        </Link>
        <Link
          href="/login"
          className="inline-flex w-full items-center justify-center border border-ink/25 px-4 py-3 text-sm font-semibold transition-colors hover:border-accent hover:text-accent"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <FormMessage>{state.message}</FormMessage>
      <p className="text-sm leading-relaxed text-ink-soft">
        Sign in and send a fresh verification email from your account settings.
      </p>
      <Link
        href="/login"
        className="inline-flex w-full items-center justify-center bg-ink px-4 py-3 text-sm font-semibold text-paper transition-colors hover:bg-accent"
      >
        Go to sign in
      </Link>
    </div>
  );
}
