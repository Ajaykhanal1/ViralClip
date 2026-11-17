'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { AuthUser } from '@viralclip/shared';
import { errorMessage } from '@/lib/auth-api';
import { useAuthStore } from '@/store/auth-store';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';

const PASSWORD_HINT = 'At least 10 characters, including a letter and a number.';

function Panel({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-ink/20 bg-panel">
      <div className="border-b border-ink/15 px-5 py-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">{detail}</p>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function ProfileForm({ user }: { user: AuthUser }) {
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const data = new FormData(event.currentTarget);
    setPending(true);
    setMessage(null);

    try {
      await updateProfile(String(data.get('displayName') ?? ''));
      setMessage({ tone: 'success', text: 'Profile saved.' });
    } catch (caught) {
      setMessage({ tone: 'error', text: errorMessage(caught) });
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel
      title="Profile"
      detail="This name appears inside the app. Your email is used to sign in."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}
        <FormField
          label="Display name"
          name="displayName"
          defaultValue={user.displayName}
          autoComplete="name"
          minLength={2}
          maxLength={120}
          required
        />
        <SubmitButton fullWidth={false} pending={pending} pendingLabel="Saving…">
          Save profile
        </SubmitButton>
      </form>
    </Panel>
  );
}

function PasswordForm() {
  const changePassword = useAuthStore((state) => state.changePassword);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const data = new FormData(event.currentTarget);
    const newPassword = String(data.get('newPassword') ?? '');
    const confirmation = String(data.get('confirmPassword') ?? '');

    if (newPassword !== confirmation) {
      setError('The passwords do not match.');
      return;
    }

    setPending(true);
    setError(null);

    try {
      await changePassword(String(data.get('currentPassword') ?? ''), newPassword);
      // The API cleared this session; a full load discards stale client state.
      window.location.replace('/login?changed=1');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel
      title="Password"
      detail="Changing your password signs you out everywhere. Sign in again afterwards."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <FormMessage>{error}</FormMessage>}
        <FormField
          label="Current password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
        <FormField
          label="New password"
          name="newPassword"
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
        <SubmitButton fullWidth={false} pending={pending} pendingLabel="Updating…">
          Update password
        </SubmitButton>
      </form>
    </Panel>
  );
}

function AccountSummary({ user }: { user: AuthUser }) {
  return (
    <Panel title="Account" detail="Read-only details for this account.">
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-xs text-ink-soft">Email</dt>
          <dd className="mt-0.5 break-all">{user.email}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-soft">Role</dt>
          <dd className="mt-0.5 capitalize">{user.role}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-soft">Member since</dt>
          <dd className="mt-0.5">
            {new Date(user.createdAt).toLocaleDateString('en', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

function EmailVerification({ user }: { user: AuthUser }) {
  const resendVerification = useAuthStore((state) => state.resendVerification);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  if (user.emailVerified) {
    return (
      <Panel title="Email" detail="Confirmation status for the address on this account.">
        <p className="text-sm font-medium text-emerald-900">Verified</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">
          Password resets and account notices go to {user.email}.
        </p>
      </Panel>
    );
  }

  async function resend() {
    setPending(true);
    setMessage(null);
    try {
      await resendVerification();
      setMessage({ tone: 'success', text: 'Verification email sent. Check your inbox.' });
    } catch (caught) {
      setMessage({ tone: 'error', text: errorMessage(caught) });
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel title="Email" detail="Confirm this address so account recovery can reach you.">
      <p className="text-sm font-medium text-amber-900">Not verified</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft">
        Open the link in the verification email. You can send a fresh one now.
      </p>
      {message && (
        <div className="mt-3">
          <FormMessage tone={message.tone}>{message.text}</FormMessage>
        </div>
      )}
      <button
        type="button"
        onClick={() => void resend()}
        disabled={pending}
        className="mt-4 w-full border border-ink/25 px-3 py-2 text-xs font-medium transition-colors hover:border-accent hover:text-accent disabled:cursor-wait disabled:opacity-50"
      >
        {pending ? 'Sending…' : 'Send verification email'}
      </button>
    </Panel>
  );
}

function SignOutPanel() {
  const logout = useAuthStore((state) => state.logout);
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await logout();
      router.replace('/');
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel title="Session" detail="Signing out ends this session on this browser.">
      <button
        type="button"
        onClick={() => void signOut()}
        disabled={pending}
        className="w-full border border-ink/25 px-3 py-2 text-xs font-medium transition-colors hover:border-accent hover:text-accent disabled:cursor-wait disabled:opacity-50"
      >
        {pending ? 'Signing out…' : 'Sign out'}
      </button>
    </Panel>
  );
}

export function ProfileSettings() {
  const user = useAuthStore((state) => state.user);
  if (!user) return null;

  return (
    <div>
      <header className="max-w-2xl">
        <h1 className="font-serif text-4xl tracking-tight">Your account</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          Update how your name appears, confirm your email, and manage the password used to sign in.
        </p>
      </header>

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <div className="space-y-8">
          <ProfileForm user={user} />
          <PasswordForm />
        </div>
        <aside className="space-y-6">
          <AccountSummary user={user} />
          <EmailVerification user={user} />
          <SignOutPanel />
        </aside>
      </div>
    </div>
  );
}
