import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, id, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7a7e70]">
            {label}
          </label>
        )}
        <textarea
          id={id}
          className={cn(
            'flex min-h-[80px] w-full border border-[#c5c8bc] bg-[#f7f7f3] px-3 py-2 text-sm text-[#3a3d36] placeholder:text-[#8a8d82] focus:outline-none focus:ring-2 focus:ring-[#8b917c]/30 focus:border-[#8b917c] disabled:cursor-not-allowed disabled:opacity-50 transition-colors resize-none',
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
Textarea.displayName = 'Textarea'

export { Textarea }
