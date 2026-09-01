import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, id, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5 min-w-0 w-full">
        {label && (
          <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7a7e70]">
            {label}
          </label>
        )}
        <input
          id={id}
          className={cn(
            'box-border min-w-0 max-w-full flex h-9 w-full border border-[#c5c8bc] bg-[#f7f7f3] px-3 py-2 text-base text-[#3a3d36] placeholder:text-[#8a8d82] focus:outline-none focus:ring-2 focus:ring-[#8b917c]/30 focus:border-[#8b917c] disabled:cursor-not-allowed disabled:opacity-50 transition-colors sm:text-sm',
            error && 'border-red-500 focus:ring-red-500/20 focus:border-red-500',
            className
          )}
          ref={ref}
          {...props}
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    )
  }
)
Input.displayName = 'Input'

export { Input }
