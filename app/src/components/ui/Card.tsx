import React from 'react';
import { cn } from './utils';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Adds hover elevation + slight lift. */
  interactive?: boolean;
  /** Removes inner padding (caller controls spacing). */
  flush?: boolean;
  /** Accent color of the left status rail, if any. */
  rail?: 'met' | 'partial' | 'unmet' | 'primary' | 'accent' | 'none';
}

const railColors: Record<NonNullable<CardProps['rail']>, string> = {
  none: '',
  met: 'before:bg-met',
  partial: 'before:bg-partial',
  unmet: 'before:bg-unmet',
  primary: 'before:bg-primary',
  accent: 'before:bg-accent',
};

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ interactive, flush, rail = 'none', className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'relative overflow-hidden rounded-lg border border-border bg-surface shadow-e1',
        'transition-all duration-200',
        !flush && 'p-5',
        interactive &&
          'hover:-translate-y-0.5 hover:border-border-strong hover:shadow-e2',
        rail !== 'none' &&
          cn(
            "before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-['']",
            railColors[rail]
          ),
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
);
Card.displayName = 'Card';

export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...props
}) => (
  <div
    className={cn(
      'mb-4 flex items-start justify-between gap-3 border-b border-border pb-3',
      className
    )}
    {...props}
  />
);

export const CardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({
  className,
  ...props
}) => (
  <h3
    className={cn('text-base font-semibold leading-tight text-text', className)}
    {...props}
  />
);
