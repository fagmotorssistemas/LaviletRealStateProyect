'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import { Menu, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { InmobiliariaAccountMenu } from '@/components/layout/InmobiliariaAccountMenu'
import {
  crmModules,
  itemsForModule,
  moduleFromPath,
} from '@/components/layout/inmobiliariaNav'

const SIDEBAR_STORAGE_KEY = 'lavilet-sidebar-collapsed'

export function InmobiliariaSidebar() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const reduceMotion = useReducedMotion()
  const activeModule = moduleFromPath(pathname)
  const menuItems = itemsForModule(activeModule)

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1')
    } catch {
      setCollapsed(false)
    }
  }, [])

  useEffect(() => {
    if (!mobileOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [mobileOpen])

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      const next = !value
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 bg-[#555c4a] px-3 md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          className="cursor-pointer rounded-lg p-2 text-[#f4f4ef] hover:bg-white/10"
          aria-label={mobileOpen ? 'Cerrar menú' : 'Abrir menú'}
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <div className="rounded-md bg-[#f4f4ef] px-2 py-1">
          <Image
            src="/LogoHorizontal.png"
            alt="Lavilet"
            width={130}
            height={36}
            className="h-7 w-auto object-contain"
          />
        </div>
        <div className="ml-auto">
          <InmobiliariaAccountMenu />
        </div>
      </header>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/45 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        data-collapsed={collapsed ? 'true' : 'false'}
        className={cn(
          'crm-sidebar relative z-50 flex h-[100dvh] shrink-0 flex-col overflow-visible transition-[width,transform] duration-300',
          'fixed inset-y-0 left-0 md:relative md:z-10 md:h-full md:translate-x-0',
          collapsed ? 'w-64 md:w-[4.75rem]' : 'w-64',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
      >
        <div
          className={cn(
            'hidden h-16 shrink-0 items-center md:flex',
            collapsed ? 'justify-center px-2' : 'px-4',
          )}
        >
          {!collapsed && (
            <Link
              href="/"
              className="flex h-10 w-full items-center justify-center bg-[#f4f4ef] px-2"
              onClick={() => setMobileOpen(false)}
            >
              <Image
                src="/LogoHorizontal.png"
                alt="Lavilet"
                width={200}
                height={48}
                className="h-8 w-full object-contain"
                preload
              />
            </Link>
          )}
        </div>
        <div className="flex items-center justify-end px-4 pt-4 md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="cursor-pointer rounded-lg p-1.5 text-[#c5c8bc] hover:bg-white/10"
            aria-label="Cerrar menú"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1 px-3 pb-2 md:hidden">
          {crmModules.map((module) => (
            <Link
              key={module.id}
              href={module.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                'rounded-full px-2 py-2 text-center text-[11px] font-semibold tracking-[0.14em] uppercase',
                module.id === activeModule
                  ? 'bg-white text-[#3a3d36]'
                  : 'text-[#f4f4ef]/80 hover:text-white',
              )}
            >
              {module.label}
            </Link>
          ))}
        </div>

        <LayoutGroup id="crm-nav">
          <nav className="crm-sidebar-nav relative min-h-0 flex-1 space-y-1 overflow-y-auto py-3 pl-2 pr-0">
            {menuItems.map((item) => {
              const isActive = pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  title={item.label}
                  className={cn(
                    'relative z-0 flex items-center gap-3 py-3 text-[15px] font-semibold tracking-[0.12em] uppercase transition-colors duration-200',
                    collapsed ? 'justify-center px-0 md:px-0' : 'pr-4 pl-4',
                    isActive
                      ? 'z-10 text-[#3a3d36]'
                      : 'text-[#f4f4ef]/85 hover:text-white',
                  )}
                >
                  {isActive && (
                    reduceMotion ? (
                      <span className="crm-nav-cutout" />
                    ) : (
                      <motion.span
                        layoutId="crm-nav-cutout"
                        className="crm-nav-cutout"
                        transition={{ type: 'spring', stiffness: 380, damping: 34, mass: 0.6 }}
                      />
                    )
                  )}
                  <item.icon
                    size={20}
                    strokeWidth={1.75}
                    className={cn(
                      'relative z-10 shrink-0',
                      isActive ? 'text-[#7a806c]' : 'text-[#c5c8bc]',
                    )}
                  />
                  <span className={cn('relative z-10 truncate', collapsed && 'md:sr-only')}>
                    {item.label}
                  </span>
                </Link>
              )
            })}
          </nav>
        </LayoutGroup>

        <div className="mt-auto hidden shrink-0 py-2 md:flex">
          <button
            type="button"
            onClick={toggleCollapsed}
            className={cn(
              'flex w-full cursor-pointer items-center justify-center gap-2 py-2 text-[12px] font-semibold tracking-[0.14em] uppercase text-[#c5c8bc] transition-colors hover:text-[#f4f4ef]',
            )}
            aria-label={collapsed ? 'Mostrar menú' : 'Ocultar menú'}
            title={collapsed ? 'Mostrar menú' : 'Ocultar menú'}
          >
            {collapsed ? (
              <ChevronRight size={18} strokeWidth={1.75} />
            ) : (
              <>
                <ChevronLeft size={16} strokeWidth={1.75} />
                Ocultar menú
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  )
}
