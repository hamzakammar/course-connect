import React from 'react';
import { cn } from './utils';

export interface SpinnerProps {
  size?: number;
  className?: string;
  label?: string;
}

export const Spinner: React.FC<SpinnerProps> = ({
  size = 20,
  className,
  label = 'Loading',
}) => (
  <span
    role="status"
    aria-label={label}
    className={cn('inline-block shrink-0 rounded-full', className)}
    style={{
      width: size,
      height: size,
      border: `${Math.max(2, Math.round(size / 10))}px solid var(--border-strong)`,
      borderTopColor: 'var(--primary)',
      animation: 'cc-spin 0.7s linear infinite',
    }}
  />
);
