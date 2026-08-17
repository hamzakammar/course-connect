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
  /** Show a leading status square. */
  dot?: boolean;
}

// Editorial tags: hairline frame, square, uppercase tracked label.
const tones: Record<BadgeTone, string> = {
  neutral: 'border-border-strong text-muted',
  primary: 'border-text text-text',
  accent: 'border-accent text-accent-soft-fg',
  met: 'border-text text-text',
  partial: 'border-partial-border text-partial-fg',
  unmet: 'border-unmet-border text-unmet-fg',
};

const dotColors: Record<BadgeTone, string> = {
  neutral: 'bg-faint',
  primary: 'bg-text',
  accent: 'bg-accent',
  met: 'bg-text',
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
      'inline-flex items-center gap-1.5 rounded-none border px-1.5 py-0.5',
      'text-[0.62rem] font-semibold uppercase leading-4 tracking-[0.12em] whitespace-nowrap',
      mono && 'font-mono lowercase tracking-normal',
      tones[tone],
      className
    )}
    {...props}
  >
    {dot && (
      <span
        className={cn('h-1.5 w-1.5 shrink-0', dotColors[tone])}
        aria-hidden
      />
    )}
    {children}
  </span>
);

/** Monospace course code (e.g. CS 241) — plain ink, no chrome. */
export const CourseCode: React.FC<
  React.HTMLAttributes<HTMLSpanElement> & { active?: boolean }
> = ({ active, className, children, ...props }) => (
  <span
    className={cn(
      'font-mono text-[0.82rem] tracking-tight tabular-nums',
      active ? 'font-semibold text-text' : 'font-medium text-text',
      className
    )}
    {...props}
  >
    {children}
  </span>
);
