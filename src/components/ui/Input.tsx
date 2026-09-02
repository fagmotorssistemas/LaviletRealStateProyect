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
          <label htmlFor={id} className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#2B1A18]/45">
            {label}
          </label>
        )}
        <input
          id={id}
          className={cn(
            'box-border min-w-0 max-w-full flex h-9 w-full border border-[#2B1A18]/12 bg-white px-3 py-2 text-base text-[#2B1A18] placeholder:text-[#2B1A18]/35 focus:outline-none focus:ring-2 focus:ring-[#BDA27E]/30 focus:border-[#BDA27E] disabled:cursor-not-allowed disabled:opacity-50 transition-colors sm:text-sm',
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
