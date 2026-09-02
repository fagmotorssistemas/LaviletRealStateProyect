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
          <label htmlFor={id} className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#2B1A18]/45">
            {label}
          </label>
        )}
        <textarea
          id={id}
          className={cn(
            'flex min-h-[80px] w-full border border-[#2B1A18]/12 bg-white px-3 py-2 text-sm text-[#2B1A18] placeholder:text-[#2B1A18]/35 focus:outline-none focus:ring-2 focus:ring-[#BDA27E]/30 focus:border-[#BDA27E] disabled:cursor-not-allowed disabled:opacity-50 transition-colors resize-none',
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
