'use client'

import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center text-sm font-semibold tracking-[0.08em] transition-[color,background-color,border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b917c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7f7f4] disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
  {
    variants: {
      variant: {
        primary:
          'bg-[#555c4a] text-[#f4f4ef] border border-[#555c4a] hover:bg-[#4a5040] hover:shadow-[0_8px_18px_rgba(85,92,74,0.18)]',
        destructive: 'bg-[#8a5c58] text-[#f4f4ef] hover:bg-[#7a504c] border border-[#8a5c58]',
        outline:
          'border border-[#b8bcae] bg-white text-[#3a3d36] hover:border-[#555c4a] hover:bg-white',
        secondary: 'bg-[#e8e9e3] text-[#3a3d36] hover:bg-[#d5d7ce] border border-[#c5c8bc]',
        ghost: 'text-[#3a3d36] hover:bg-[#e8e9e3]',
        link: 'text-[#7a7e70] underline-offset-4 hover:underline',
        gold: 'bg-[#8b917c] text-[#f4f4ef] hover:bg-[#7a806c] border border-[#7a806c]',
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
