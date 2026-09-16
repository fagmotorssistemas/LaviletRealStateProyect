'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { SiteHeader } from './SiteHeader'
import { SiteFooter } from './SiteFooter'
import { EspaciosAccordion } from './EspaciosAccordion'
import { MarketingThemeProvider } from './theme'

const ESPACIOS_PATHS = new Set(['/inicio', '/nosotros'])

export function MarketingFrame({
  children,
  showFooter = true,
}: {
  children: ReactNode
  showFooter?: boolean
}) {
  const pathname = usePathname()
  const showEspacios = ESPACIOS_PATHS.has(pathname)

  return (
    <MarketingThemeProvider>
      <SiteHeader />
      {children}
      {showEspacios ? <EspaciosAccordion /> : null}
      {showFooter ? <SiteFooter /> : null}
    </MarketingThemeProvider>
  )
}
