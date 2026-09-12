'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/**
 * Contenedor de ruta CRM sin slide pesado.
 * Antes AnimatePresence mode="wait" + crm-rise congelaban el scroll
 * hasta que terminaba la animación y el contenido “aparecía de golpe”.
 */
export function InmobiliariaRouteKey({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  return (
    <div key={pathname} className="crm-reveal">
      {children}
    </div>
  )
}
