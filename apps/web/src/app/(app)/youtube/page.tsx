import { Suspense } from 'react';
import { YouTubeView } from '@/components/youtube/youtube-view';

export default function YouTubePage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-soft">Loading YouTube status…</p>}>
      <YouTubeView />
    </Suspense>
  );
}
