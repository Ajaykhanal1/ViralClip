import { Suspense } from 'react';
import { RenderView } from '@/components/render/render-view';

export default function RenderPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-soft">Loading renders…</p>}>
      <RenderView />
    </Suspense>
  );
}
