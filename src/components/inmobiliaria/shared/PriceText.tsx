import { formatCurrency } from '@/lib/utils'
import { cn } from '@/lib/utils'

interface PriceTextProps {
  value: number | null | undefined
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
}

export function PriceText({ value, className, size = 'md' }: PriceTextProps) {
  return (
    <span className={cn('font-semibold text-gray-900', sizeClasses[size], className)}>
      {formatCurrency(value)}
    </span>
  )
}
