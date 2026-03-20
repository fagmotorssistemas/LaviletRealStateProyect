'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

export function InmobiliariaRouteKey({ children }: { children: ReactNode }) {
  const pathname = usePathname()

  // Fuerza el remount del contenido al cambiar de módulo.
  // Esto evita estados tipo `isLoading` que pueden quedar "pegados" en navegación SPA.
  return <div key={pathname}>{children}</div>
}

