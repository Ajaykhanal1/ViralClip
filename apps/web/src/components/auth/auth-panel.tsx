export function AuthPanel({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className="border border-ink/20 bg-panel">
      <div className="sprockets h-3 border-b border-ink/10" aria-hidden="true" />
      <div className="p-6 sm:p-8">
        <h1 className="font-serif text-3xl tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">{description}</p>
        <div className="mt-7">{children}</div>
      </div>
      {footer && (
        <div className="border-t border-ink/15 px-6 py-4 text-sm text-ink-soft sm:px-8">
          {footer}
        </div>
      )}
    </section>
  );
}
