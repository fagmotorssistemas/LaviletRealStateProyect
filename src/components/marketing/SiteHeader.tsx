'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Menu, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { homePathForRole } from '@/lib/inmobiliaria/roleAccess'
import { MARKETING_NAV } from '@/lib/marketing/nav'
import { cn } from '@/lib/utils'

const ease = [0.22, 1, 0.36, 1] as const

export function SiteHeader() {
  const pathname = usePathname()
  const reduceMotion = useReducedMotion()
  const { user, profile, isLoading } = useAuth()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const overHero = (pathname === '/inicio' || pathname === '/nosotros') && !scrolled && !open
  const solid = !overHero
  const accountHref = user ? homePathForRole(profile?.role) : '/login'
  const accountLabel = user ? (profile?.role === 'visitante' ? 'Mi cuenta' : 'Panel') : 'Acceso'

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [pathname])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  const linkTone = (href: string) =>
    solid
      ? pathname === href
        ? 'text-[#2B1A18]'
        : 'text-[#2B1A18]/70 hover:text-[#2B1A18]'
      : pathname === href
        ? 'text-white'
        : 'text-white/85 hover:text-white'

  return (
    <motion.header
      data-site-header
      initial={reduceMotion ? false : { y: -16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.55, ease }}
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-500',
        solid
          ? 'border-b border-[#2B1A18]/8 bg-[#f7f3ee]/90 backdrop-blur-md'
          : 'border-b border-transparent bg-transparent',
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-4 px-5 sm:px-8 lg:gap-6 lg:px-12">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.05, ease }}
        >
          <Link
            href="/inicio"
            className={cn(
              'relative z-10 text-[11px] font-medium tracking-[0.28em] uppercase transition-[color,letter-spacing] duration-300 hover:tracking-[0.34em]',
              solid ? 'text-[#2B1A18]' : 'text-white',
            )}
          >
            Lavilet
          </Link>
        </motion.div>

        <nav className="hidden items-center gap-5 lg:flex xl:gap-8">
          {MARKETING_NAV.map((item, i) => {
            const active = pathname === item.href
            return (
              <motion.div
                key={item.href}
                initial={reduceMotion ? false : { opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.12 + i * 0.06, ease }}
              >
                <Link
                  href={item.href}
                  className={cn(
                    'group relative inline-block py-1 text-[11px] font-medium tracking-[0.22em] uppercase transition-colors duration-300',
                    linkTone(item.href),
                  )}
                >
                  {item.label}
                  {active ? (
                    <motion.span
                      layoutId="nav-active-line"
                      className={cn(
                        'absolute inset-x-0 -bottom-0.5 h-px',
                        solid ? 'bg-[#C45C3E]' : 'bg-white',
                      )}
                      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    />
                  ) : (
                    <span
                      className={cn(
                        'pointer-events-none absolute inset-x-0 -bottom-0.5 h-px origin-left scale-x-0 transition-transform duration-300 group-hover:scale-x-100',
                        solid ? 'bg-[#2B1A18]/35' : 'bg-white/50',
                      )}
                    />
                  )}
                </Link>
              </motion.div>
            )
          })}
        </nav>

        <div className="hidden items-center gap-6 lg:flex">
          {!isLoading && (
            <motion.div
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.45, delay: 0.4, ease }}
            >
              <Link
                href={accountHref}
                className={cn(
                  'text-[11px] font-medium tracking-[0.18em] uppercase transition-colors duration-300',
                  solid ? 'text-[#2B1A18]/40 hover:text-[#2B1A18]' : 'text-white/55 hover:text-white',
                )}
              >
                {accountLabel}
              </Link>
            </motion.div>
          )}
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.48, ease }}
            whileHover={reduceMotion ? undefined : { y: -1 }}
            whileTap={reduceMotion ? undefined : { scale: 0.98 }}
          >
            <Link
              href="/contacto"
              className={cn(
                'group relative inline-flex items-center text-[11px] font-medium tracking-[0.22em] uppercase transition-colors duration-300',
                solid ? 'text-[#2B1A18] hover:text-[#BDA27E]' : 'text-white hover:text-[#BDA27E]',
              )}
            >
              Agendar visita
              <span
                className={cn(
                  'ml-2 inline-block h-px w-5 origin-left transition-transform duration-300 group-hover:scale-x-150',
                  solid ? 'bg-[#BDA27E]' : 'bg-white/70 group-hover:bg-[#BDA27E]',
                )}
              />
            </Link>
          </motion.div>
        </div>

        <motion.button
          type="button"
          className={cn(
            'relative z-10 rounded-lg p-2 lg:hidden',
            solid ? 'text-[#2B1A18]' : 'text-white',
          )}
          aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          whileTap={reduceMotion ? undefined : { scale: 0.92 }}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={open ? 'close' : 'open'}
              initial={reduceMotion ? false : { opacity: 0, rotate: -40, scale: 0.8 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0, rotate: 40, scale: 0.8 }}
              transition={{ duration: 0.2, ease }}
              className="block"
            >
              {open ? <X size={22} /> : <Menu size={22} />}
            </motion.span>
          </AnimatePresence>
        </motion.button>
      </div>

      <AnimatePresence>
        {open ? (
          <motion.div
            key="mobile-nav"
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease }}
            className="overflow-hidden border-t border-[#2B1A18]/10 bg-[#f7f3ee] lg:hidden"
          >
            <div className="px-5 pb-6 pt-2">
              <nav className="flex flex-col gap-1">
                {MARKETING_NAV.map((item, i) => (
                  <motion.div
                    key={item.href}
                    initial={reduceMotion ? false : { opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.35, delay: 0.06 + i * 0.05, ease }}
                  >
                    <Link
                      href={item.href}
                      className={cn(
                        'flex items-center justify-between rounded-lg px-3 py-3 text-sm tracking-[0.18em] uppercase transition-colors hover:bg-[#2B1A18]/5',
                        pathname === item.href ? 'text-[#2B1A18]' : 'text-[#2B1A18]/80',
                      )}
                      onClick={() => setOpen(false)}
                    >
                      {item.label}
                      {pathname === item.href ? (
                        <span className="h-1 w-1 rounded-full bg-[#C45C3E]" />
                      ) : null}
                    </Link>
                  </motion.div>
                ))}
              </nav>
              <motion.div
                className="mt-4 flex flex-col gap-2"
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.28, ease }}
              >
                <Link
                  href="/contacto"
                  className="px-3 py-2 text-sm tracking-[0.18em] text-[#2B1A18] uppercase"
                  onClick={() => setOpen(false)}
                >
                  Agendar visita
                </Link>
                <Link
                  href={accountHref}
                  className="px-3 py-2 text-sm tracking-[0.18em] text-[#2B1A18]/40 uppercase"
                  onClick={() => setOpen(false)}
                >
                  {accountLabel}
                </Link>
              </motion.div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.header>
  )
}
