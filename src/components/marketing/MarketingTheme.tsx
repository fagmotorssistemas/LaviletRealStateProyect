'use client'

import type { ReactNode } from 'react'
import { SiteHeader } from './SiteHeader'
import { SiteFooter } from './SiteFooter'
import { MarketingThemeProvider } from './theme'

export function MarketingFrame({
  children,
  showFooter = true,
}: {
  children: ReactNode
  showFooter?: boolean
}) {
  return (
    <MarketingThemeProvider>
      <SiteHeader />
      {children}
      {showFooter ? <SiteFooter /> : null}
    </MarketingThemeProvider>
  )
}
