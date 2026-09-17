'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Menu, X } from 'lucide-react'
import { ThemeToggle, useMarketingTheme } from './theme'
import { useAuth } from '@/contexts/AuthContext'
import { homePathForRole } from '@/lib/inmobiliaria/roleAccess'
import {
  isShowroomIdentified,
  SHOWROOM_IDENTITY_EVENT,
} from '@/lib/tour/showroomIdentity'
import { MARKETING_NAV } from '@/lib/marketing/nav'
import { cn } from '@/lib/utils'
import { HERO_LOCKED_EVENT, isHeroLocked } from './heroLock'

const ease = [0.22, 1, 0.36, 1] as const
const HERO_PATHS = new Set(['/inicio', '/nosotros'])
const HEADER_HIDDEN = new Set(['/proyectos', '/proceso'])

export function SiteHeader() {
  const pathname = usePathname()
  const reduceMotion = useReducedMotion()
  const { user, profile, isLoading } = useAuth()
  const { theme } = useMarketingTheme()
  const nuvia = theme === 'dark'
  const editorial = theme === '3'
  const waitsForHero = HERO_PATHS.has(pathname)
  const [scrolled, setScrolled] = useState(false)
  const [pastHero, setPastHero] = useState(false)
  const [heroLocked, setHeroLocked] = useState(!waitsForHero)
  const [open, setOpen] = useState(false)
  const [hasPhone, setHasPhone] = useState(false)
  const [navHidden, setNavHidden] = useState(false)
  const lastScrollY = useRef(0)
  const headerReady = !waitsForHero || heroLocked || open || pastHero || editorial
  const overHero = waitsForHero && !heroLocked && !scrolled && !open && !editorial
  const overPhoto = nuvia && waitsForHero && !pastHero && !open
  const solid = editorial ? scrolled || open : !overHero && !overPhoto
  const accountHref = user ? homePathForRole(profile?.role) : '/login'
  const accountLabel = user ? (profile?.role === 'visitante' ? 'Mi cuenta' : 'Panel') : 'Acceso'

  const navItems = useMemo(
    () =>
      MARKETING_NAV.filter((item) => {
        if (HEADER_HIDDEN.has(item.href)) return false
        return 'requiresPhone' in item && item.requiresPhone ? hasPhone : true
      }),
    [hasPhone],
  )

  useEffect(() => {
    const sync = () => setHasPhone(isShowroomIdentified())
    sync()
    window.addEventListener(SHOWROOM_IDENTITY_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(SHOWROOM_IDENTITY_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  useEffect(() => {
    if (!waitsForHero) {
      setHeroLocked(true)
      return
    }
    const onLocked = () => setHeroLocked(true)
    window.addEventListener(HERO_LOCKED_EVENT, onLocked)
    setHeroLocked(isHeroLocked())
    return () => window.removeEventListener(HERO_LOCKED_EVENT, onLocked)
  }, [pathname, waitsForHero])

  useEffect(() => {
    lastScrollY.current = window.scrollY
    const onScroll = () => {
      const y = window.scrollY
      setScrolled(y > 24)
      setPastHero(y > window.innerHeight * 0.85)

      const delta = y - lastScrollY.current
      if (open || y < 56) {
        setNavHidden(false)
      } else if (delta > 8) {
        setNavHidden(true)
      } else if (delta < -8) {
        setNavHidden(false)
      }
      lastScrollY.current = y
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [pathname, open])

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
    editorial || solid
      ? pathname === href
        ? 'text-[#2B1A18] mkt-dark:text-[#f4efe8] mkt-3:text-[#f4efe8]'
        : 'text-[#2B1A18]/75 hover:text-[#2B1A18] mkt-dark:text-[#f4efe8]/75 mkt-dark:hover:text-[#f4efe8] mkt-3:text-[#f4efe8]/75 mkt-3:hover:text-[#f4efe8]'
      : 'text-white [text-shadow:0_1px_14px_rgba(0,0,0,0.55)] hover:text-white'

  return (
    <motion.header
      data-site-header
      initial={reduceMotion || waitsForHero ? false : { y: -16, opacity: 0 }}
      animate={
        !headerReady ? { y: -16, opacity: 0 } : navHidden ? { y: '-110%', opacity: 1 } : { y: 0, opacity: 1 }
      }
      transition={{ duration: reduceMotion ? 0.2 : 0.45, ease }}
      aria-hidden={!headerReady || navHidden}
      inert={!headerReady || navHidden ? true : undefined}
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-500',
        solid
          ? 'border-b border-[#72735A]/12 bg-[#F2F2F2]/90 backdrop-blur-md mkt-dark:border-white/10 mkt-dark:bg-[#16141c]/75 mkt-3:border-transparent mkt-3:!bg-transparent mkt-3:!backdrop-blur-none'
          : 'border-b border-transparent bg-transparent',
        (!headerReady || navHidden) && 'pointer-events-none',
      )}
    >
      <div
        className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-4 px-5 sm:px-8 lg:gap-8 lg:px-12"
      >
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.05, ease }}
        >
          <Link
            href="/inicio"
            className={cn(
              'relative z-10 transition-[color,letter-spacing] duration-300',
              editorial
                ? 'font-serif text-[20px] font-normal tracking-[-0.03em] text-[#3f3d2e] hover:tracking-[-0.01em] lg:text-[22px]'
                : cn(
                    'text-[13px] tracking-[0.22em] uppercase hover:tracking-[0.28em] lg:text-[14px]',
                    overPhoto ? 'font-medium' : 'font-semibold',
                    solid
                      ? 'text-[#2B1A18] mkt-dark:text-[#f4efe8] mkt-3:text-[#f4efe8]'
                      : 'text-white [text-shadow:0_1px_14px_rgba(0,0,0,0.55)]',
                  ),
            )}
          >
            {editorial ? 'La Vilet' : 'Lavilet'}
          </Link>
        </motion.div>

        <nav
          className={cn(
            'hidden items-center gap-5 lg:flex xl:gap-8',
            overPhoto && 'flex-1 justify-center',
          )}
        >
          {navItems.map((item, i) => {
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
                    'group relative inline-block py-1 text-[12px] tracking-[0.18em] uppercase transition-colors duration-300 lg:text-[13px]',
                    overPhoto ? 'font-medium' : 'font-semibold',
                    linkTone(item.href),
                  )}
                >
                  {item.label}
                  {active ? (
                    <motion.span
                      layoutId="nav-active-line"
                      className={cn(
                        'absolute inset-x-0 -bottom-0.5 h-px',
                        editorial || solid ? 'bg-[#8B8C74] mkt-3:bg-[#6d6c54]' : 'bg-white',
                      )}
                      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    />
                  ) : (
                    <span
                      className={cn(
                        'pointer-events-none absolute inset-x-0 -bottom-0.5 h-px origin-left scale-x-0 transition-transform duration-300 group-hover:scale-x-100',
                        editorial || solid ? 'bg-[#2B1A18]/35 mkt-3:bg-[#3f3d2e]/35' : 'bg-white/50',
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
                  'text-[13px] font-semibold tracking-[0.14em] uppercase transition-colors duration-300 lg:text-[14px]',
                  editorial || solid
                    ? 'text-[#2B1A18]/55 hover:text-[#2B1A18] mkt-dark:text-[#f4efe8]/55 mkt-dark:hover:text-[#f4efe8] mkt-3:text-[#3f3d2e]/55 mkt-3:hover:text-[#3f3d2e]'
                    : 'text-white [text-shadow:0_1px_14px_rgba(0,0,0,0.55)] hover:text-white',
                )}
              >
                {accountLabel}
              </Link>
            </motion.div>
          )}
          <ThemeToggle
            className={
              editorial || solid
                ? 'text-[#2B1A18] hover:bg-[#2B1A18]/5 mkt-dark:text-[#f4efe8] mkt-dark:hover:bg-white/10 mkt-3:text-[#3f3d2e] mkt-3:hover:bg-[#3f3d2e]/8'
                : 'text-white [text-shadow:0_1px_14px_rgba(0,0,0,0.55)] hover:bg-white/10'
            }
          />
        </div>

        <div className="flex items-center gap-1 lg:hidden">
          <ThemeToggle
            className={
              editorial || solid
                ? 'text-[#2B1A18] hover:bg-[#2B1A18]/5 mkt-dark:text-[#f4efe8] mkt-dark:hover:bg-white/10 mkt-3:text-[#3f3d2e] mkt-3:hover:bg-[#3f3d2e]/8'
                : 'text-white hover:bg-white/10'
            }
          />
          <motion.button
            type="button"
            className={cn(
              'relative z-10 rounded-lg p-2',
              editorial || solid
                ? 'text-[#2B1A18] mkt-dark:text-[#f4efe8] mkt-3:text-[#f4efe8]'
                : 'text-white [text-shadow:0_1px_14px_rgba(0,0,0,0.55)]',
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
      </div>

      <AnimatePresence>
        {open ? (
          <motion.div
            key="mobile-nav"
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease }}
            className="overflow-hidden border-t border-[#72735A]/12 bg-[#F2F2F2] mkt-dark:border-[#F2F2F2]/12 mkt-dark:bg-[#72735A] mkt-3:border-[#6d6c54]/12 mkt-3:bg-[#f3eee6] lg:hidden"
          >
            <div className="px-5 pb-6 pt-2">
              <nav className="flex flex-col gap-1">
                {navItems.map((item, i) => (
                  <motion.div
                    key={item.href}
                    initial={reduceMotion ? false : { opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.35, delay: 0.06 + i * 0.05, ease }}
                  >
                    <Link
                      href={item.href}
                      className={cn(
                        'flex items-center justify-between rounded-lg px-3 py-3 text-sm tracking-[0.18em] uppercase transition-colors hover:bg-[#2B1A18]/5 mkt-dark:hover:bg-white/5',
                        pathname === item.href
                          ? 'text-[#72735A] mkt-dark:text-[#F2F2F2]'
                          : 'text-[#72735A]/80 mkt-dark:text-[#F2F2F2]/80',
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
                  href={accountHref}
                  className="px-3 py-2 text-sm tracking-[0.18em] text-[#2B1A18]/40 uppercase mkt-dark:text-[#f4efe8]/40"
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
