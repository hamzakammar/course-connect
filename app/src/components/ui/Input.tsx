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
          'h-10 w-full rounded-none border-0 border-b bg-transparent px-0 text-sm text-text',
          'placeholder:text-faint transition-colors duration-150',
          'focus-visible:outline-none focus:border-text',
          'disabled:cursor-not-allowed disabled:opacity-45',
          invalid ? 'border-accent' : 'border-border-strong',
          leadingIcon != null && 'pl-7',
          className
        )}
        {...props}
      />
    );

    if (leadingIcon == null) return field;

    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-faint">
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
  <div className={cn('flex flex-col gap-2', className)}>
    {label != null && (
      <label htmlFor={htmlFor} className="eyebrow">
        {label}
      </label>
    )}
    {children}
    {error != null ? (
      <p className="text-xs text-accent-soft-fg">{error}</p>
    ) : (
      hint != null && <p className="text-xs text-muted">{hint}</p>
    )}
  </div>
);
