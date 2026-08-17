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
  'rounded-md select-none cursor-pointer transition-all duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-bg ' +
  'active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55 ' +
  'disabled:active:translate-y-0';

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-fg shadow-e1 hover:bg-primary-hover hover:shadow-e2',
  accent:
    'bg-accent text-accent-fg shadow-e1 hover:bg-accent-hover hover:shadow-e2',
  success:
    'bg-met text-white shadow-e1 hover:brightness-110 hover:shadow-e2',
  danger:
    'bg-unmet text-white shadow-e1 hover:brightness-110 hover:shadow-e2',
  secondary:
    'bg-surface-2 text-text border border-border hover:bg-surface-3 hover:border-border-strong',
  outline:
    'bg-transparent text-text border border-border-strong hover:bg-surface-2',
  ghost:
    'bg-transparent text-muted hover:bg-surface-2 hover:text-text',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[0.8125rem]',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
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
