import React from 'react';
import { cn } from './utils';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'accent'
  | 'success'
  | 'danger'
  | 'outline';

export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
}

const base =
  'inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap ' +
  'rounded-none border select-none cursor-pointer transition-colors duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-bg ' +
  'disabled:cursor-not-allowed disabled:opacity-45';

// Editorial: solid ink primary, hairline secondaries, one red accent.
const variants: Record<ButtonVariant, string> = {
  primary:
    'border-primary bg-primary text-primary-fg hover:bg-primary-hover hover:border-primary-hover',
  accent:
    'border-accent bg-accent text-accent-fg hover:bg-accent-hover hover:border-accent-hover',
  success:
    'border-primary bg-primary text-primary-fg hover:bg-primary-hover hover:border-primary-hover',
  secondary:
    'border-border-strong bg-transparent text-text hover:bg-surface-2',
  outline:
    'border-text bg-transparent text-text hover:bg-text hover:text-bg',
  ghost:
    'border-transparent bg-transparent text-muted hover:text-text hover:bg-surface-2',
  danger:
    'border-transparent bg-transparent text-muted hover:text-accent hover:bg-accent-soft',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[0.8125rem]',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-[0.95rem]',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      fullWidth,
      leadingIcon,
      trailingIcon,
      className,
      children,
      type = 'button',
      ...props
    },
    ref
  ) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        base,
        variants[variant],
        sizes[size],
        fullWidth && 'w-full',
        className
      )}
      {...props}
    >
      {leadingIcon != null && (
        <span className="-ml-0.5 inline-flex shrink-0">{leadingIcon}</span>
      )}
      {children}
      {trailingIcon != null && (
        <span className="-mr-0.5 inline-flex shrink-0">{trailingIcon}</span>
      )}
    </button>
  )
);

Button.displayName = 'Button';
