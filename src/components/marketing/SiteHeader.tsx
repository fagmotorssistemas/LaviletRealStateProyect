'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { homePathForRole } from '@/lib/inmobiliaria/roleAccess'
import { cn } from '@/lib/utils'

const NAV_BASE = [
  { href: '#proyectos', label: 'Proyectos' },
  { href: '#nosotros', label: 'Nosotros' },
  { href: '#proceso', label: 'Proceso' },
  { href: '#contacto', label: 'Contacto' },
]

export function SiteHeader() {
  const { user, profile, isLoading } = useAuth()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const solid = scrolled || open
  const NAV = [{ href: '#tour', label: 'Tour' }, ...NAV_BASE]
  const accountHref = user ? homePathForRole(profile?.role) : '/login'
  const accountLabel = user ? (profile?.role === 'visitante' ? 'Mi cuenta' : 'Panel') : 'Acceso'

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-colors duration-300',
        solid
          ? 'border-b border-[#2B1A18]/8 bg-[#f7f3ee]/90 backdrop-blur-md'
          : 'bg-transparent',
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-6 px-5 sm:px-8 lg:px-12">
        <a
          href="#inicio"
          className={cn(
            'relative z-10 text-[11px] font-medium tracking-[0.28em] uppercase transition-colors',
            solid ? 'text-[#2B1A18]' : 'text-white',
          )}
          onClick={() => setOpen(false)}
        >
          Lavilet
        </a>

        <nav className="hidden items-center gap-8 md:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={cn(
                'text-[11px] font-medium tracking-[0.22em] uppercase transition-colors',
                solid ? 'text-[#2B1A18]/70 hover:text-[#2B1A18]' : 'text-white/85 hover:text-white',
              )}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-6 md:flex">
          {!isLoading && (
            <Link
              href={accountHref}
              className={cn(
                'text-[11px] font-medium tracking-[0.18em] uppercase transition-colors',
                solid ? 'text-[#2B1A18]/40 hover:text-[#2B1A18]' : 'text-white/55 hover:text-white',
              )}
            >
              {accountLabel}
            </Link>
          )}
          <a
            href="#contacto"
            className={cn(
              'text-[11px] font-medium tracking-[0.22em] uppercase transition-colors',
              solid ? 'text-[#2B1A18] hover:text-[#BDA27E]' : 'text-white hover:text-[#BDA27E]',
            )}
          >
            Agendar visita
          </a>
        </div>

        <button
          type="button"
          className={cn(
            'relative z-10 rounded-lg p-2 md:hidden',
            solid ? 'text-[#2B1A18]' : 'text-white',
          )}
          aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {open && (
        <div className="border-t border-[#2B1A18]/10 bg-[#f7f3ee] px-5 pb-6 pt-2 md:hidden">
          <nav className="flex flex-col gap-1">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-3 text-sm tracking-[0.18em] text-[#2B1A18]/80 uppercase hover:bg-[#2B1A18]/5"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="mt-4 flex flex-col gap-2">
            <a
              href="#contacto"
              className="px-3 py-2 text-sm tracking-[0.18em] text-[#2B1A18] uppercase"
              onClick={() => setOpen(false)}
            >
              Agendar visita
            </a>
            <Link
              href={accountHref}
              className="px-3 py-2 text-sm tracking-[0.18em] text-[#2B1A18]/40 uppercase"
              onClick={() => setOpen(false)}
            >
              {accountLabel}
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}
