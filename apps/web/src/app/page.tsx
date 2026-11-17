import { PipelineTimeline } from '@/components/pipeline-timeline';
import { SiteHeader } from '@/components/site-header';
import { SystemStatus } from '@/components/system-status';

export default function Home() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-8 sm:px-10 sm:py-10">
      <SiteHeader />

      <div className="grid gap-12 pt-14 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16 lg:pt-20">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-soft">
            Phase 2 / accounts
          </p>
          <h1 className="mt-5 max-w-[14ch] font-serif text-5xl leading-[0.98] tracking-[-0.02em] sm:text-6xl lg:text-7xl">
            Foundation, now with the front door.
          </h1>
          <p className="mt-7 max-w-[58ch] text-base leading-relaxed text-ink-soft">
            ViralClip AI turns long videos into short-form clips. Accounts are live: register, sign
            in, confirm your email, and manage your profile. The underlying services are wired the
            same way as in Phase 1.
          </p>
          <p className="mt-4 max-w-[58ch] text-base leading-relaxed text-ink-soft">
            Nothing is rendered yet. Upload, transcription, clip selection, and export arrive in a
            later phase.
          </p>

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

      <PipelineTimeline />

      <footer className="mt-20 flex flex-col gap-2 border-t border-ink/20 py-6 text-xs text-ink-soft sm:flex-row sm:items-center sm:justify-between">
        <p>MySQL stores metadata and storage keys only. Media files stay on disk or in S3.</p>
        <p className="font-mono">docs/ARCHITECTURE.md</p>
      </footer>
    </main>
  );
}
