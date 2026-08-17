import React from 'react';
import { cn } from './utils';

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Element rendered inside the field, before the input (e.g. a search icon). */
  leadingIcon?: React.ReactNode;
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ leadingIcon, invalid, className, ...props }, ref) => {
    const field = (
      <input
        ref={ref}
        className={cn(
          'h-10 w-full rounded-md border bg-surface px-3 text-sm text-text',
          'placeholder:text-faint transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'focus-visible:ring-offset-1 focus-visible:ring-offset-bg',
          'disabled:cursor-not-allowed disabled:opacity-55',
          invalid ? 'border-unmet' : 'border-border hover:border-border-strong',
          leadingIcon != null && 'pl-9',
          className
        )}
        {...props}
      />
    );

    if (leadingIcon == null) return field;

    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint">
          {leadingIcon}
        </span>
        {field}
      </div>
    );
  }
);
Input.displayName = 'Input';

export interface FieldProps {
  label?: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export const Field: React.FC<FieldProps> = ({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}) => (
  <div className={cn('flex flex-col gap-1.5', className)}>
    {label != null && (
      <label
        htmlFor={htmlFor}
        className="text-sm font-medium text-text"
      >
        {label}
      </label>
    )}
    {children}
    {error != null ? (
      <p className="text-xs text-unmet-fg">{error}</p>
    ) : (
      hint != null && <p className="text-xs text-muted">{hint}</p>
    )}
  </div>
);
