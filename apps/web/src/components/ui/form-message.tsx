const tones = {
  error: 'border-red-700 bg-red-50 text-red-900',
  success: 'border-emerald-700 bg-emerald-50 text-emerald-900',
  notice: 'border-line bg-paper text-ink-soft',
} as const;

export function FormMessage({
  children,
  tone = 'error',
}: {
  children: React.ReactNode;
  tone?: keyof typeof tones;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`border-l-2 px-3 py-2.5 text-sm leading-relaxed ${tones[tone]}`}
    >
      {children}
    </div>
  );
}
