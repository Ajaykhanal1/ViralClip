'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth-store';

export function SiteHeader() {
  const user = useAuthStore((state) => state.user);
  const status = useAuthStore((state) => state.status);
  const hydrate = useAuthStore((state) => state.hydrate);
  const logout = useAuthStore((state) => state.logout);
  const router = useRouter();
  const pathname = usePathname();
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
    <header className="border-b border-ink/20 pb-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid size-7 place-items-center bg-accent text-xs font-bold text-white">
            V
          </span>
          <span className="text-sm font-semibold tracking-tight">ViralClip AI</span>
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          {status === 'authenticated' && user ? (
            <>
              <span className="mr-2 hidden text-ink-soft sm:inline">{user.displayName}</span>
              <Link
                href="/settings/profile"
                className={`px-3 py-1.5 transition-colors hover:text-accent ${
                  pathname === '/settings/profile' ? 'text-accent' : ''
                }`}
              >
                Settings
              </Link>
              <button
                type="button"
                onClick={() => void signOut()}
                disabled={signingOut}
                className="border border-ink/25 px-3 py-1.5 text-xs font-medium transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {signingOut ? 'Signing out' : 'Sign out'}
              </button>
            </>
          ) : status === 'guest' || status === 'idle' ? (
            <>
              <Link href="/login" className="px-3 py-1.5 transition-colors hover:text-accent">
                Sign in
              </Link>
              <Link
                href="/register"
                className="bg-ink px-3 py-1.5 text-xs font-semibold text-paper transition-colors hover:bg-accent"
              >
                Create account
              </Link>
            </>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
