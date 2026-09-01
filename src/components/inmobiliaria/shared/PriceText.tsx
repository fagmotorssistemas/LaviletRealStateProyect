import { cn } from '@/lib/utils'

interface PriceTextProps {
  value: number | null | undefined
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'text-[15px] leading-none',
  md: 'text-base leading-none',
  lg: 'text-[1.65rem] leading-none',
}

export function PriceText({ value, className, size = 'md' }: PriceTextProps) {
  if (value == null) {
    return (
      <span className={cn('crm-num font-sans text-[#8a8d82]', sizeClasses[size], className)}>
        —
      </span>
    )
  }

  const parts = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).formatToParts(value)

  return (
    <span
      className={cn(
        'crm-num inline-flex items-baseline font-sans font-semibold tracking-tight text-[#2f2924]',
        sizeClasses[size],
        className,
      )}
    >
      {parts.map((part, index) => {
        if (part.type === 'currency') {
          return (
            <span key={index} className="mr-[0.18em] font-medium opacity-55">
              {part.value}
            </span>
          )
        }
        if (part.type === 'decimal' || part.type === 'fraction') {
          return (
            <span key={index} className="text-[0.86em] font-medium opacity-70">
              {part.value}
            </span>
          )
        }
        return <span key={index}>{part.value}</span>
      })}
    </span>
  )
}
