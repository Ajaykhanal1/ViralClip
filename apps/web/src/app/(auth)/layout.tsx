import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[0.95fr_1.05fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-ink p-10 text-paper lg:flex">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid size-7 place-items-center bg-accent text-xs font-bold text-white">
            V
          </span>
          <span className="text-sm font-semibold tracking-tight">ViralClip AI</span>
        </Link>

        <div className="max-w-sm">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-paper/60">
            Phase 2 / accounts
          </p>
          <p className="mt-6 font-serif text-4xl leading-[1.05] tracking-tight">
            Your footage stays yours.
          </p>
          <p className="mt-5 text-sm leading-relaxed text-paper/70">
            Sign in to manage your account. Projects, uploads, and the clip pipeline arrive in a
            later phase.
          </p>
        </div>

        <div className="sprockets h-3 opacity-25" aria-hidden="true" />
      </aside>

      <main className="flex min-h-screen items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center justify-between gap-4 lg:hidden">
            <Link href="/" className="flex items-center gap-3">
              <span className="grid size-7 place-items-center bg-accent text-xs font-bold text-white">
                V
              </span>
              <span className="text-sm font-semibold tracking-tight">ViralClip AI</span>
            </Link>
            <span className="border border-ink/20 px-2.5 py-1 text-xs text-ink-soft">Phase 2</span>
          </div>

          {children}

          <p className="mt-6 text-xs leading-relaxed text-ink-soft">
            Accounts are protected with expiring sessions. Signing out ends this session on this
            browser only.
          </p>
        </div>
      </main>
    </div>
  );
}
