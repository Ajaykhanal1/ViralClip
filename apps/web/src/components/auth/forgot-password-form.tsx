'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { errorMessage, forgotPassword } from '@/lib/auth-api';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';

export function ForgotPasswordForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(null);

    try {
      await forgotPassword({ email: String(data.get('email') ?? '') });
      setSent(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-5">
        <FormMessage tone="success">
          If that email is registered, a reset link is on its way. The link expires in one hour.
        </FormMessage>
        <p className="text-sm leading-relaxed text-ink-soft">
          Check your spam folder if it does not arrive. You can request another link in a few
          minutes.
        </p>
        <Link
          href="/login"
          className="inline-flex w-full items-center justify-center border border-ink/25 px-4 py-3 text-sm font-semibold transition-colors hover:border-accent hover:text-accent"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <FormMessage>{error}</FormMessage>}

      <FormField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@studio.com"
        required
      />

      <SubmitButton pending={pending} pendingLabel="Sending link…">
        Send reset link
      </SubmitButton>
    </form>
  );
}
