import React from 'react';
import { cn } from './utils';

export type BadgeTone =
  | 'neutral'
  | 'primary'
  | 'accent'
  | 'met'
  | 'partial'
  | 'unmet';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Renders in a monospace face — ideal for course codes. */
  mono?: boolean;
  /** Show a leading status dot. */
  dot?: boolean;
}

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-muted border-border',
  primary: 'bg-primary-soft text-primary-soft-fg border-transparent',
  accent: 'bg-accent-soft text-accent-soft-fg border-transparent',
  met: 'bg-met-soft text-met-fg border-met-border',
  partial: 'bg-partial-soft text-partial-fg border-partial-border',
  unmet: 'bg-unmet-soft text-unmet-fg border-unmet-border',
};

const dotColors: Record<BadgeTone, string> = {
  neutral: 'bg-faint',
  primary: 'bg-primary',
  accent: 'bg-accent',
  met: 'bg-met',
  partial: 'bg-partial',
  unmet: 'bg-unmet',
};

export const Badge: React.FC<BadgeProps> = ({
  tone = 'neutral',
  mono,
  dot,
  className,
  children,
  ...props
}) => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5',
      'text-xs font-medium leading-5 whitespace-nowrap',
      mono && 'font-mono tracking-tight',
      tones[tone],
      className
    )}
    {...props}
  >
    {dot && (
      <span
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotColors[tone])}
        aria-hidden
      />
    )}
    {children}
  </span>
);

/** Monospace pill for course codes (e.g. CS 241). */
export const CourseCode: React.FC<
  React.HTMLAttributes<HTMLSpanElement> & { active?: boolean }
> = ({ active, className, children, ...props }) => (
  <span
    className={cn(
      'inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[0.78rem] font-semibold tracking-tight',
      active
        ? 'bg-met-soft text-met-fg'
        : 'bg-primary-soft text-primary-soft-fg',
      className
    )}
    {...props}
  >
    {children}
  </span>
);
