import type { ReactNode } from 'react'
import { MarketingFrame } from './MarketingTheme'

export function MarketingShell({
  children,
  showFooter = true,
}: {
  children: ReactNode
  showFooter?: boolean
}) {
  return <MarketingFrame showFooter={showFooter}>{children}</MarketingFrame>
}
