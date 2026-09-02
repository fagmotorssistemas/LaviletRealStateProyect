'use client'

import { cn } from '@/lib/utils'

interface PersonCellProps {
  name?: string | null
  avatarUrl?: string | null
  emptyLabel?: string
  className?: string
  size?: 'sm' | 'md'
}

export function PersonCell({
  name,
  emptyLabel = 'Sin asignar',
  className,
}: PersonCellProps) {
  if (!name?.trim()) {
    return <span className={cn('text-sm text-[#8a8d82]', className)}>{emptyLabel}</span>
  }

  return (
    <span className={cn('truncate text-sm font-semibold text-[#555850]', className)}>
      {name}
    </span>
  )
}
