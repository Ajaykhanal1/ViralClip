import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { SystemStatus } from '@/components/system-status';

export default function Home() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-8 sm:px-10 sm:py-10">
      <SiteHeader />

      <div className="grid gap-12 pt-14 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16 lg:pt-20">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-soft">
            Phase 3 / workspace
          </p>
          <h1 className="mt-5 max-w-[14ch] font-serif text-5xl leading-[0.98] tracking-[-0.02em] sm:text-6xl lg:text-7xl">
            Projects, now in one place.
          </h1>
          <p className="mt-7 max-w-[58ch] text-base leading-relaxed text-ink-soft">
            ViralClip AI turns long videos into short-form clips. Sign in to manage projects, track
            imported videos and clips, and monitor processing from your dashboard.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="bg-ink px-4 py-2 text-sm font-semibold text-paper transition-colors hover:bg-accent"
            >
              Open dashboard
            </Link>
            <Link
              href="/register"
              className="border border-ink/25 px-4 py-2 text-sm font-medium transition-colors hover:border-accent hover:text-accent"
            >
              Create account
            </Link>
          </div>

          <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-ink/20 pt-5">
            <div>
              <dt className="text-xs text-ink-soft">Frontend</dt>
              <dd className="mt-1 text-sm font-medium">localhost:3000</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-soft">API</dt>
              <dd className="mt-1 text-sm font-medium">localhost:4000</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-soft">AI engine</dt>
              <dd className="mt-1 text-sm font-medium">localhost:8000</dd>
            </div>
          </dl>
        </div>

        <div className="lg:pt-2">
          <SystemStatus />
        </div>
      </div>

      <footer className="mt-20 flex flex-col gap-2 border-t border-ink/20 py-6 text-xs text-ink-soft sm:flex-row sm:items-center sm:justify-between">
        <p>MySQL stores metadata and storage keys only. Media files stay on disk or in S3.</p>
        <p className="font-mono">docs/ARCHITECTURE.md</p>
      </footer>
    </main>
  );
}
