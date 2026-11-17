import { AuthGuard } from '@/components/auth-guard';
import { SiteHeader } from '@/components/site-header';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <main className="mx-auto min-h-screen max-w-6xl px-6 py-8 sm:px-10 sm:py-10">
        <SiteHeader />
        <div className="pt-12 sm:pt-16">{children}</div>
      </main>
    </AuthGuard>
  );
}
