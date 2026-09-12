'use client'

import { usePathname } from 'next/navigation'
import { CrmRoleGate } from '@/components/layout/CrmRoleGate'
import { InmobiliariaSidebar } from '@/components/layout/InmobiliariaSidebar'
import { InmobiliariaTopbar } from '@/components/layout/InmobiliariaTopbar'
import { InmobiliariaRouteKey } from '@/components/layout/InmobiliariaRouteKey'
import { AppointmentInboxBanner } from '@/components/layout/AppointmentInboxBanner'
import { VisitInboxProvider } from '@/contexts/VisitInboxContext'
import { MarketingShell } from '@/components/marketing/MarketingShell'

/** Rutas de lead/cliente (cookies/teléfono) sin login CRM. Redirigen a /simulador. */
const PUBLIC_INMOBILIARIA_PREFIXES = ['/inmobiliaria/mis-escenarios', '/inmobiliaria/simulador']


export default function InmobiliariaLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || ''
  const isPublicLeadRoute = PUBLIC_INMOBILIARIA_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )

  if (isPublicLeadRoute) {
    return (
      <MarketingShell>
        <div className="px-4 py-10 sm:px-8 sm:py-14">{children}</div>
      </MarketingShell>
    )
  }

  return (
    <CrmRoleGate>
      <VisitInboxProvider>
      <div className="crm-app relative flex h-[100dvh] overflow-hidden">
        <InmobiliariaSidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <InmobiliariaTopbar />
          <AppointmentInboxBanner />
          <div className="crm-app-canvas min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-5 py-8 pt-[calc(3.5rem+2rem)] sm:px-8 md:pt-8 lg:px-12">
            <InmobiliariaRouteKey>{children}</InmobiliariaRouteKey>
          </div>
        </div>
      </div>
      </VisitInboxProvider>
    </CrmRoleGate>
  )
}
