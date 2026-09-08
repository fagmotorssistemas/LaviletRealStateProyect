'use client'

import Link from 'next/link'
import { useRoleAccess } from '@/hooks/useRoleAccess'

export function AutomationSectionTabs({ active }: { active: 'monitoreo' | 'reglas' | 'guion' }) {
  const { isAdmin } = useRoleAccess()

  return (
    <div className="crm-tabs">
      <Link href="/inmobiliaria/automatizacion" data-active={active === 'monitoreo'} className="crm-tab no-underline">
        Monitoreo
      </Link>
      {isAdmin ? (
        <Link href="/inmobiliaria/automatizacion/reglas" data-active={active === 'reglas'} className="crm-tab no-underline">
          Reglas
        </Link>
      ) : null}
      {isAdmin ? (
        <Link href="/inmobiliaria/automatizacion/guion" data-active={active === 'guion'} className="crm-tab no-underline">
          Guion
        </Link>
      ) : null}
    </div>
  )
}
