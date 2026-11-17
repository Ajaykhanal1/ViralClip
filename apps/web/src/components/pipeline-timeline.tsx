const stages = [
  { name: 'Web', detail: 'Next.js, React, Tailwind' },
  { name: 'API', detail: 'Express, /api/v1' },
  { name: 'Queue', detail: 'Redis + BullMQ' },
  { name: 'Worker', detail: 'Node.js consumers' },
  { name: 'Media', detail: 'AI engine + FFmpeg' },
  { name: 'Data', detail: 'MySQL + object storage' },
];

export function PipelineTimeline() {
  return (
    <section aria-labelledby="pipeline-heading" className="mt-20">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h2 id="pipeline-heading" className="font-serif text-2xl tracking-tight">
            How a clip moves
          </h2>
          <p className="mt-2 max-w-[58ch] text-sm leading-relaxed text-ink-soft">
            Every stage is a separate service. HTTP handlers only enqueue work; video and AI
            processing happen in workers so a slow render never blocks an API request.
          </p>
        </div>
      </div>

      <div className="mt-8 border border-ink/20 bg-panel">
        <div className="sprockets h-3 border-b border-ink/10" aria-hidden="true" />
        <ol className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          {stages.map((stage, index) => (
            <li
              key={stage.name}
              className="timeline-clip border-r border-b border-line/70 p-4 last:border-r-0 lg:border-b-0"
              style={{ animationDelay: `${index * 70}ms` }}
            >
              <span className="font-mono text-[11px] text-ink-soft/70">
                {String(index + 1).padStart(2, '0')}
              </span>
              <p className="mt-6 text-sm font-semibold">{stage.name}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">{stage.detail}</p>
            </li>
          ))}
        </ol>
        <div className="sprockets h-3 border-t border-ink/10" aria-hidden="true" />
      </div>
    </section>
  );
}
