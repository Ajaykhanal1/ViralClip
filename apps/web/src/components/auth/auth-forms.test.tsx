import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const login = vi.fn();
const register = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));
vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock('@/store/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({ login, register }),
}));
vi.mock('@/lib/auth-api', () => ({
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : 'Request failed'),
}));

import { LoginForm } from '@/components/auth/login-form';
import { RegisterForm } from '@/components/auth/register-form';

describe('registration form validation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('enforces client-side password rules in the markup', () => {
    render(<RegisterForm />);
    const password = screen.getByLabelText('Password') as HTMLInputElement;
    expect(password.required).toBe(true);
    expect(password.minLength).toBe(10);
    expect(password.pattern).toContain('[A-Za-z]');
    expect(password.pattern).toContain('[0-9]');
    expect((screen.getByLabelText('Display name') as HTMLInputElement).minLength).toBe(2);
  });

  it('blocks submission when passwords differ', async () => {
    render(<RegisterForm />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password124' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Create account' }).closest('form')!);

    expect(await screen.findByText('The passwords do not match.')).toBeTruthy();
    expect(register).not.toHaveBeenCalled();
  });

  it('registers and navigates with matching passwords', async () => {
    register.mockResolvedValue(undefined);
    render(<RegisterForm />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password123' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Create account' }).closest('form')!);

    await waitFor(() => expect(register).toHaveBeenCalledWith({
      email: 'a@b.com', displayName: 'Ada', password: 'password123',
    }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
  });
});

describe('login form', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows API errors and stays on the page', async () => {
    login.mockRejectedValue(new Error('Invalid email or password'));
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);

    expect(await screen.findByText('Invalid email or password')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it('disables the submit button while a request is pending', async () => {
    let release!: () => void;
    login.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);

    const button = await screen.findByRole('button', { name: 'Signing in…' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    release();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
  });
});
