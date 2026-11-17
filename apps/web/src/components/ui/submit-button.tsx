import type { ButtonHTMLAttributes } from 'react';

interface SubmitButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  pending?: boolean;
  pendingLabel?: string;
  fullWidth?: boolean;
}

export function SubmitButton({
  pending = false,
  pendingLabel = 'Working…',
  fullWidth = true,
  children,
  className = '',
  disabled,
  ...button
}: SubmitButtonProps) {
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={`inline-flex items-center justify-center bg-ink px-4 py-3 text-sm font-semibold text-paper transition-colors hover:bg-accent disabled:cursor-wait disabled:opacity-60 ${fullWidth ? 'w-full' : ''} ${className}`}
      {...button}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
