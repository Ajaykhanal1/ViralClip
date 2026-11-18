'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth-store';

const nav = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/projects', label: 'Projects' },
  { href: '/imports', label: 'Imports' },
  { href: '/settings/profile', label: 'Settings' },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {nav.map((item) => {
        const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`px-3 py-2 text-sm transition-colors ${
              active ? 'bg-ink text-paper' : 'text-ink-soft hover:bg-ink/5 hover:text-ink'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const hydrate = useAuthStore((s) => s.hydrate);
  const logout = useAuthStore((s) => s.logout);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  async function signOut() {
    setSigningOut(true);
    try {
      await logout();
      router.replace('/');
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto flex min-h-screen max-w-7xl">
        <aside className="hidden w-56 shrink-0 border-r border-ink/15 bg-panel/60 p-4 md:flex md:flex-col">
          <Link href="/dashboard" className="mb-8 flex items-center gap-2 px-3">
            <span className="grid size-7 place-items-center bg-accent text-xs font-bold text-white">V</span>
            <span className="text-sm font-semibold tracking-tight">ViralClip AI</span>
          </Link>
          <NavLinks />
          <div className="mt-auto border-t border-ink/15 pt-4 px-3 text-xs text-ink-soft">
            <p className="truncate font-medium text-ink">{user?.displayName}</p>
            <p className="truncate">{user?.email}</p>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-ink/15 bg-paper/95 px-4 py-3 backdrop-blur sm:px-6">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="border border-ink/20 px-2 py-1 text-xs md:hidden"
                onClick={() => setOpen(true)}
                aria-label="Open navigation"
              >
                Menu
              </button>
              <Link href="/dashboard" className="flex items-center gap-2 md:hidden">
                <span className="grid size-6 place-items-center bg-accent text-[10px] font-bold text-white">V</span>
                <span className="text-sm font-semibold">ViralClip</span>
              </Link>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/projects?new=1"
                className="bg-ink px-3 py-1.5 text-xs font-semibold text-paper transition-colors hover:bg-accent"
              >
                New project
              </Link>
              <button
                type="button"
                onClick={() => void signOut()}
                disabled={signingOut}
                className="hidden border border-ink/20 px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50 sm:inline-flex"
              >
                {signingOut ? 'Signing out' : 'Sign out'}
              </button>
            </div>
          </header>

          {open ? (
            <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
              <button
                type="button"
                className="absolute inset-0 bg-ink/30"
                aria-label="Close navigation"
                onClick={() => setOpen(false)}
              />
              <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-ink/15 bg-panel p-4 shadow-xl">
                <div className="mb-6 flex items-center justify-between">
                  <span className="text-sm font-semibold">Navigation</span>
                  <button type="button" className="text-xs text-ink-soft" onClick={() => setOpen(false)}>
                    Close
                  </button>
                </div>
                <NavLinks onNavigate={() => setOpen(false)} />
                <div className="mt-6 border-t border-ink/15 pt-4 text-xs text-ink-soft">
                  <p className="font-medium text-ink">{user?.displayName}</p>
                  <button
                    type="button"
                    onClick={() => void signOut()}
                    className="mt-3 border border-ink/20 px-3 py-1.5 text-xs font-medium"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
