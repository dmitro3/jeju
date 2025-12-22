'use client'

import { type HTMLAttributes } from 'react'

export interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'outline' | 'destructive'
}

export function Badge({ className = '', variant = 'default', children, ...props }: BadgeProps) {
  const baseStyles = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors'
  
  const variantStyles = {
    default: 'bg-primary text-primary-foreground',
    outline: 'border border-current bg-transparent',
    destructive: 'bg-destructive text-destructive-foreground',
  }

  return (
    <div
      className={`${baseStyles} ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}
