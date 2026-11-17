'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { errorMessage, resetPassword } from '@/lib/auth-api';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';

const PASSWORD_HINT = 'At least 10 characters, including a letter and a number.';

export function ResetPasswordForm({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <div className="space-y-5">
        <FormMessage>
          This reset link is incomplete. Request a new one and open the link from your email.
        </FormMessage>
        <Link
          href="/forgot-password"
          className="inline-flex w-full items-center justify-center border border-ink/25 px-4 py-3 text-sm font-semibold transition-colors hover:border-accent hover:text-accent"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-5">
        <FormMessage tone="success">
          Your password is updated. Sign in with the new password.
        </FormMessage>
        <Link
          href="/login?changed=1"
          className="inline-flex w-full items-center justify-center bg-ink px-4 py-3 text-sm font-semibold text-paper transition-colors hover:bg-accent"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const data = new FormData(event.currentTarget);
    const password = String(data.get('password') ?? '');
    const confirmation = String(data.get('confirmPassword') ?? '');

    if (password !== confirmation) {
      setError('The passwords do not match.');
      return;
    }

    setPending(true);
    setError(null);

    try {
      await resetPassword({ token, password });
      setDone(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <FormMessage>{error}</FormMessage>}

      <FormField
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        hint={PASSWORD_HINT}
        minLength={10}
        maxLength={128}
        pattern="(?=.*[A-Za-z])(?=.*[0-9]).*"
        title={PASSWORD_HINT}
        required
      />

      <FormField
        label="Confirm new password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        minLength={10}
        maxLength={128}
        required
      />

      <SubmitButton pending={pending} pendingLabel="Updating password…">
        Update password
      </SubmitButton>
    </form>
  );
}
