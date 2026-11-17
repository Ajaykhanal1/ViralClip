import type { InputHTMLAttributes } from 'react';

interface FormFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  id?: string;
  name: string;
  label: string;
  hint?: string;
  error?: string;
}

export function FormField({ id, name, label, hint, error, ...input }: FormFieldProps) {
  const fieldId = id ?? name;
  const detailId = `${fieldId}-detail`;
  const detail = error ?? hint;

  return (
    <div>
      <label htmlFor={fieldId} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={fieldId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={detail ? detailId : undefined}
        className="mt-1.5 w-full border border-ink/25 bg-paper px-3 py-2.5 text-sm text-ink transition-colors placeholder:text-ink-soft/60 focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-red-700"
        {...input}
      />
      {detail && (
        <p
          id={detailId}
          className={`mt-1.5 text-xs leading-relaxed ${error ? 'text-red-800' : 'text-ink-soft'}`}
        >
          {detail}
        </p>
      )}
    </div>
  );
}
