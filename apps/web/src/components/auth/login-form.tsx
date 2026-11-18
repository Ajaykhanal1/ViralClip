'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '@/lib/auth-api';
import { useAuthStore } from '@/store/auth-store';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';

export function LoginForm({ notice }: { notice?: string }) {
  const login = useAuthStore((state) => state.login);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(null);

    try {
      await login(String(data.get('email') ?? ''), String(data.get('password') ?? ''));
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
      {notice && <FormMessage tone="success">{notice}</FormMessage>}
      {error && <FormMessage>{error}</FormMessage>}

      <FormField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@studio.com"
        required
      />

      <div>
        <FormField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <div className="mt-2 text-right">
          <Link
            href="/forgot-password"
            className="text-xs text-ink-soft underline-offset-4 hover:text-accent hover:underline"
          >
            Forgot password?
          </Link>
        </div>
      </div>

      <SubmitButton pending={pending} pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
