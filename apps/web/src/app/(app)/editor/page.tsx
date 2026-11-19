import { Suspense } from 'react';
import { EditorView } from '@/components/editor/editor-view';

export default function EditorPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-soft">Loading editor…</p>}>
      <EditorView />
    </Suspense>
  );
}
