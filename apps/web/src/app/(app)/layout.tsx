import { AuthGuard } from '@/components/auth-guard';
import { DashboardShell } from '@/components/dashboard/shell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <DashboardShell>{children}</DashboardShell>
    </AuthGuard>
  );
}
