'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '@/lib/auth-api';
import { useAuthStore } from '@/store/auth-store';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';

const PASSWORD_HINT = 'At least 10 characters, including a letter and a number.';

export function RegisterForm() {
  const register = useAuthStore((state) => state.register);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await register({
        email: String(data.get('email') ?? ''),
        displayName: String(data.get('displayName') ?? ''),
        password,
      });
      router.replace('/dashboard');
      router.refresh();
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
        label="Display name"
        name="displayName"
        autoComplete="name"
        placeholder="Ada Lovelace"
        minLength={2}
        maxLength={120}
        required
      />

      <FormField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@studio.com"
        required
      />

      <FormField
        label="Password"
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
        label="Confirm password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        minLength={10}
        maxLength={128}
        required
      />

      <SubmitButton pending={pending} pendingLabel="Creating account…">
        Create account
      </SubmitButton>
    </form>
  );
}
