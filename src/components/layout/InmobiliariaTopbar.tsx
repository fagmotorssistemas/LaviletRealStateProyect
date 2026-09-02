'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { crmModules, moduleFromPath } from '@/components/layout/inmobiliariaNav'
import { InmobiliariaAccountMenu } from '@/components/layout/InmobiliariaAccountMenu'
import { cn } from '@/lib/utils'

export function InmobiliariaTopbar() {
  const pathname = usePathname()
  const activeModule = moduleFromPath(pathname)

  return (
    <header className="crm-topbar relative z-40 hidden h-16 shrink-0 items-center justify-between overflow-visible bg-[#fcfbf9] text-[#2B1A18] md:flex">
      <nav className="flex h-full items-stretch gap-1 px-8" aria-label="Módulos">
        {crmModules.map((module) => {
          const isActive = module.id === activeModule
          return (
            <Link
              key={module.id}
              href={module.href}
              className={cn(
                'relative flex items-center px-5 text-[13px] font-semibold tracking-[0.18em] uppercase transition-colors',
                isActive ? 'text-[#2B1A18]' : 'text-[#2B1A18]/55 hover:text-[#2B1A18]',
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
