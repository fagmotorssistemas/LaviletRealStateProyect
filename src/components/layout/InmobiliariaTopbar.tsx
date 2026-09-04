'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { moduleFromPath, modulesForRole } from '@/components/layout/inmobiliariaNav'
import { InmobiliariaAccountMenu } from '@/components/layout/InmobiliariaAccountMenu'
import { useAuth } from '@/contexts/AuthContext'
import { knownRole } from '@/lib/inmobiliaria/roleAccess'
import { cn } from '@/lib/utils'

export function InmobiliariaTopbar() {
  const pathname = usePathname()
  const { profile, user } = useAuth()
  const activeModule = moduleFromPath(pathname)
  const visibleModules = modulesForRole(knownRole(profile?.role))

  return (
    <header className="crm-topbar relative z-40 hidden h-16 shrink-0 items-center justify-between overflow-visible bg-[#fcfbf9] text-[#555850] md:flex">
      <nav className="flex h-full items-stretch gap-1 px-8" aria-label="Módulos">
        {visibleModules.length === 0 && user
          ? [1, 2, 3].map((key) => (
              <span key={key} className="flex items-center px-5">
                <span className="h-2.5 w-16 rounded-full bg-[#2B1A18]/8" />
              </span>
            ))
          : null}
        {visibleModules.map((module) => {
          const isActive = module.id === activeModule
          return (
            <Link
              key={module.id}
              href={module.href}
              className={cn(
                'relative flex items-center px-5 text-[13px] font-semibold tracking-[0.18em] uppercase transition-colors',
                isActive ? 'text-[#4a4d48]' : 'text-[#6e716b] hover:text-[#4a4d48]',
              )}
            >
              {module.label}
              {isActive && <span className="crm-topbar-indicator" />}
            </Link>
          )
        })}
      </nav>
      <div className="pr-5">
        <InmobiliariaAccountMenu tone="light" />
      </div>
    </header>
  )
}
