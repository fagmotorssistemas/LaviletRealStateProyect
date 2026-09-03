'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { InmobiliariaAccountMenu } from '@/components/layout/InmobiliariaAccountMenu'
import {
  itemsForModule,
  moduleFromPath,
  modulesForRole,
} from '@/components/layout/inmobiliariaNav'
import { useAuth } from '@/contexts/AuthContext'

const SIDEBAR_STORAGE_KEY = 'lavilet-sidebar-collapsed'

export function InmobiliariaSidebar() {
  const pathname = usePathname()
  const { profile, isLoading } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const visibleModules = isLoading ? [] : modulesForRole(profile?.role)
  const activeModule = moduleFromPath(pathname)
  const menuItems = isLoading ? [] : itemsForModule(activeModule, profile?.role)

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
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 bg-[#787D62] px-4 md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          className="cursor-pointer rounded-2xl p-2 text-white hover:bg-white/10"
          aria-label={mobileOpen ? 'Cerrar menú' : 'Abrir menú'}
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <Link
          href="/"
          className="text-[11px] font-medium tracking-[0.28em] text-white uppercase"
        >
          Lavilet
        </Link>
        <div className="ml-auto">
          <InmobiliariaAccountMenu tone="dark" />
        </div>
      </header>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#787D62]/40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        data-collapsed={collapsed ? 'true' : 'false'}
        className={cn(
          'crm-sidebar relative z-50 flex h-[100dvh] shrink-0 flex-col overflow-hidden bg-[#787D62] text-white transition-[width,transform] duration-300 md:overflow-visible',
          'fixed inset-y-0 left-0 md:relative md:z-10 md:h-full md:translate-x-0',
          collapsed ? 'w-64 md:w-[4.75rem]' : 'w-64',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
      >
        <div
          className={cn(
            'hidden h-16 shrink-0 items-center md:flex',
            collapsed ? 'justify-center px-2' : 'px-5',
          )}
        >
          <Link
            href="/"
            className={cn(
              'text-[11px] font-medium tracking-[0.28em] text-white uppercase transition-colors hover:text-white/80',
              collapsed && 'md:tracking-[0.08em]',
            )}
            onClick={() => setMobileOpen(false)}
          >
            {collapsed ? 'L' : 'Lavilet'}
          </Link>
        </div>
        <div className="flex items-center justify-end px-4 pt-4 md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="cursor-pointer rounded-2xl p-1.5 text-white/80 hover:bg-white/10"
            aria-label="Cerrar menú"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1 px-4 pb-3 md:hidden">
          {visibleModules.map((module) => (
            <Link
              key={module.id}
              href={module.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                'rounded-2xl px-2 py-2 text-center text-[11px] font-medium tracking-[0.22em] uppercase transition-colors',
                module.id === activeModule
                  ? 'bg-white text-[#787D62]'
                  : 'text-white/75 hover:bg-white/10 hover:text-white',
              )}
            >
              {module.label}
            </Link>
          ))}
        </div>

        <nav className="crm-sidebar-nav relative min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-4 md:pr-0">
          {menuItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                title={item.label}
                className={cn(
                  'relative flex items-center gap-3 py-3 text-[13px] font-semibold tracking-[0.16em] uppercase transition-colors duration-200',
                  collapsed ? 'justify-center px-0' : 'px-3.5 md:pr-4',
                  isActive
                    ? 'z-10 bg-white text-[#787D62] md:bg-transparent'
                    : 'rounded-2xl text-white/80 hover:bg-white/10 hover:text-white md:mr-3',
                  isActive && 'rounded-2xl md:rounded-none',
                )}
              >
                {isActive && <span className="crm-nav-cutout" aria-hidden />}
                <item.icon
                  size={20}
                  strokeWidth={1.5}
                  className={cn('relative z-10 shrink-0', isActive ? 'text-[#787D62]' : 'text-white/70')}
                />
                <span className={cn('relative z-10 truncate', collapsed && 'md:sr-only')}>
                  {item.label}
                </span>
              </Link>
            )
          })}
        </nav>

        <div className="mt-auto hidden shrink-0 px-3 py-3 md:flex">
          <button
            type="button"
            onClick={toggleCollapsed}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl py-2.5 text-[11px] font-medium tracking-[0.18em] text-white/60 uppercase transition-colors hover:bg-white/10 hover:text-white"
            aria-label={collapsed ? 'Mostrar menú' : 'Ocultar menú'}
            title={collapsed ? 'Mostrar menú' : 'Ocultar menú'}
          >
            {collapsed ? (
              <ChevronRight size={16} strokeWidth={1.5} />
            ) : (
              <>
                <ChevronLeft size={14} strokeWidth={1.5} />
                Ocultar
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  )
}
