import { cn } from '@/lib/utils'

interface PriceTextProps {
  value: number | null | undefined
  className?: string
  size?: 'sm' | 'md' | 'lg'
  masked?: boolean
}

const sizeClasses = {
  sm: 'text-[15px] leading-none',
  md: 'text-base leading-none',
  lg: 'text-[1.65rem] leading-none',
}

export function PriceText({ value, className, size = 'md', masked = false }: PriceTextProps) {
  if (value == null) {
    return (
      <span className={cn('crm-num font-sans font-semibold text-[#555850]', sizeClasses[size], className)}>
        —
      </span>
    )
  }

  if (masked) {
    return (
      <span
        className={cn(
          'crm-num inline-flex items-baseline font-sans font-semibold tracking-tight text-[#555850]',
          sizeClasses[size],
          className,
        )}
        aria-label="Monto oculto"
      >
        <span className="mr-[0.18em]">$</span>
        <span className="tracking-[0.12em]">****.**</span>
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
        'crm-num inline-flex items-baseline font-sans font-semibold tracking-tight text-[#555850]',
        sizeClasses[size],
        className,
      )}
    >
      {parts.map((part, index) => {
        if (part.type === 'currency') {
          return (
            <span key={index} className="mr-[0.18em]">
              {part.value}
            </span>
          )
        }
        if (part.type === 'decimal' || part.type === 'fraction') {
          return (
            <span key={index} className="text-[0.86em]">
              {part.value}
            </span>
          )
        }
        return <span key={index}>{part.value}</span>
      })}
    </span>
  )
}
