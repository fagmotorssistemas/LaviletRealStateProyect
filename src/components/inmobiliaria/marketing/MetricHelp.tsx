'use client'

import { Button, Tooltip, TooltipTrigger } from 'react-aria-components'
import { useState, type ReactNode } from 'react'

/** Help is available on hover, keyboard focus, and tap; Escape dismisses it. */
export function MetricHelp({ children, explanation, className }: {
  children: ReactNode
  explanation: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <TooltipTrigger delay={150} isOpen={open} onOpenChange={setOpen}>
      <Button onPress={() => setOpen(value => !value)} className={className || 'inline-flex items-center gap-1 text-left cursor-help rounded focus-visible:outline-2 focus-visible:outline-[#5b4a9a]'}>
        {children}<span aria-hidden="true" className="ml-1 text-[#8a8176]">ⓘ</span>
      </Button>
      <Tooltip placement="top" className="z-[100] max-w-[min(20rem,90vw)] rounded-xl bg-[#2b241e] px-4 py-3 text-sm font-normal normal-case leading-relaxed tracking-normal text-white shadow-lg">
        {explanation}
      </Tooltip>
    </TooltipTrigger>
  )
}
