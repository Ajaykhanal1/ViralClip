import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }), usePathname: () => '/dashboard' }));
vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => <a {...props}>{children}</a>,
}));
vi.mock('@/store/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({
    user: { displayName: 'Ada', email: 'ada@example.com' },
    status: 'authenticated',
    hydrate: vi.fn(), logout: vi.fn(),
  }),
}));
vi.mock('@/lib/account-api', () => ({ notificationState: () => Promise.resolve({ unreadCount: 0 }) }));

import { DashboardShell } from '@/components/dashboard/shell';
import { SiteHeader } from '@/components/site-header';

describe('responsive layout contracts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hides the public user name on small screens', () => {
    render(<SiteHeader />);
    const name = screen.getByText('Ada');
    expect(name.className).toContain('hidden');
    expect(name.className).toContain('sm:inline');
  });

  it('swaps a desktop sidebar for a mobile menu button', () => {
    render(<DashboardShell><p>content</p></DashboardShell>);
    const sidebar = screen.getByRole('complementary');
    expect(sidebar.className).toContain('hidden');
    expect(sidebar.className).toContain('md:flex');

    const menu = screen.getByRole('button', { name: 'Open navigation' });
    expect(menu.className).toContain('md:hidden');
    fireEvent.click(menu);
    expect(screen.getAllByRole('navigation').length).toBeGreaterThan(1);
  });

  it('keeps the content column shrinkable so wide media cannot overflow the viewport', () => {
    const { container } = render(<DashboardShell><p>content</p></DashboardShell>);
    expect(container.querySelector('.min-w-0')).not.toBeNull();
    expect(container.querySelector('.max-w-7xl')).not.toBeNull();
  });
});
