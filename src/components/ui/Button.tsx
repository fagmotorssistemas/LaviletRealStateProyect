'use client'

import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-lg text-sm font-semibold tracking-[0.12em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#787D62] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7f3ee] disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
  {
    variants: {
      variant: {
        primary:
          'bg-[#787D62] text-white hover:bg-[#6b7058]',
        destructive: 'bg-[#8a5c58] text-white hover:bg-[#7a504c]',
        outline:
          'border border-[#787D62]/25 bg-white text-[#787D62] hover:border-[#787D62] hover:bg-[#787D62]/8',
        secondary: 'bg-[#f7f3ee] text-[#787D62] hover:bg-[#efe8df] border border-[#787D62]/15',
        ghost: 'text-[#787D62] hover:bg-[#787D62]/10',
        link: 'text-[#787D62] underline-offset-4 hover:underline',
        gold: 'bg-[#BDA27E] text-[#2B1A18] hover:bg-[#ad926e]',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-11 px-6 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
