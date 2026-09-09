import type { ReactNode } from 'react'
import { SiteHeader } from './SiteHeader'
import { SiteFooter } from './SiteFooter'

export function MarketingShell({
  children,
  showFooter = true,
}: {
  children: ReactNode
  showFooter?: boolean
}) {
  return (
    <div className="min-h-screen bg-[#f7f3ee] text-[#2B1A18]">
      <SiteHeader />
      {children}
      {showFooter ? <SiteFooter /> : null}
    </div>
  )
}
