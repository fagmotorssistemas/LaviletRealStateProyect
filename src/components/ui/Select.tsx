import { forwardRef, type SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: { value: string; label: string }[]
  placeholder?: string
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, id, options, placeholder, ...props }, ref) => {
    return (
      <div className="flex min-w-0 w-full flex-col gap-1.5">
        {label && (
          <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7a7e70]">
            {label}
          </label>
        )}
        <div className="relative min-w-0">
          <select
            id={id}
            className={cn(
              'box-border min-w-0 max-w-full flex h-9 w-full border border-[#c5c8bc] bg-[#f7f7f3] py-2 pl-3 pr-10 text-base text-[#3a3d36] focus:outline-none focus:ring-2 focus:ring-[#8b917c]/30 focus:border-[#8b917c] disabled:cursor-not-allowed disabled:opacity-50 transition-colors appearance-none sm:text-sm',
              error && 'border-red-500 focus:ring-red-500/20 focus:border-red-500',
              className
            )}
            ref={ref}
            {...props}
          >
            {placeholder && <option value="">{placeholder}</option>}
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={16}
            strokeWidth={1.75}
            aria-hidden
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#7a806c]"
          />
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    )
  }
)
Select.displayName = 'Select'

export { Select }
