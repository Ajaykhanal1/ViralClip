import { Suspense } from 'react';
import { ProjectsView } from '@/components/projects/projects-view';
import { Skeleton } from '@/components/ui/card';

export default function ProjectsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <ProjectsView />
    </Suspense>
  );
}
