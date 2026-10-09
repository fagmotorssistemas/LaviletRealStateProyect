import type { ReactNode } from 'react'
import { MarketingFrame } from './MarketingTheme'
import { SmoothScrollProvider } from './SmoothScrollProvider'

export function MarketingShell({
  children,
  showFooter = true,
}: {
  children: ReactNode
  showFooter?: boolean
}) {
  return (
    <SmoothScrollProvider>
      <MarketingFrame showFooter={showFooter}>{children}</MarketingFrame>
    </SmoothScrollProvider>
  )
}
