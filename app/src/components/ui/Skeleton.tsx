import React from 'react';
import { cn } from './utils';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Shorthand for a rounded pill (e.g. text lines). */
  rounded?: 'sm' | 'md' | 'lg' | 'full';
}

const roundedMap = {
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  full: 'rounded-full',
};

export const Skeleton: React.FC<SkeletonProps> = ({
  rounded = 'md',
  className,
  style,
  ...props
}) => (
  <div
    className={cn('cc-shimmer', roundedMap[rounded], className)}
    style={style}
    aria-hidden
    {...props}
  />
);
