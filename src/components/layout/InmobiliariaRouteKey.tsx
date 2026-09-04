'use client'

import { usePathname } from 'next/navigation'
import { useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'

const MODULE_HREFS = [
  '/inmobiliaria/inventario',
  '/inmobiliaria/proyectos',
  '/inmobiliaria/leads',
  '/inmobiliaria/showroom',
  '/inmobiliaria/recorrido',
  '/inmobiliaria/agenda',
  '/inmobiliaria/financiamiento',
  '/inmobiliaria/ventas',
  '/inmobiliaria/contratos',
  '/inmobiliaria/usuarios',
]

function moduleIndex(pathname: string) {
  return MODULE_HREFS.findIndex((href) => pathname === href || pathname.startsWith(`${href}/`))
}

function slideDirection(from: string, to: string) {
  const fromIndex = moduleIndex(from)
  const toIndex = moduleIndex(to)
  if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
    return toIndex > fromIndex ? 1 : -1
  }
  const fromDepth = from.split('/').filter(Boolean).length
  const toDepth = to.split('/').filter(Boolean).length
  if (toDepth !== fromDepth) return toDepth > fromDepth ? 1 : -1
  return 1
}

const slideEase = [0.22, 1, 0.36, 1] as const

export function InmobiliariaRouteKey({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const reduceMotion = useReducedMotion()
  const previousPath = useRef(pathname)
  const directionRef = useRef(0)

  if (previousPath.current !== pathname) {
    directionRef.current = slideDirection(previousPath.current, pathname)
    previousPath.current = pathname
  }

  const direction = directionRef.current

  return (
    <AnimatePresence initial={false} custom={direction} mode="wait">
      <motion.div
        key={pathname}
        custom={direction}
        initial="enter"
        animate="center"
        exit="exit"
        variants={
          reduceMotion
            ? {
                enter: { opacity: 0 },
                center: { opacity: 1 },
                exit: { opacity: 0 },
              }
            : {
                enter: (dir: number) => ({
                  x: dir > 0 ? '18%' : '-18%',
                  opacity: 0,
                }),
                center: {
                  x: 0,
                  opacity: 1,
                },
                exit: (dir: number) => ({
                  x: dir > 0 ? '-14%' : '14%',
                  opacity: 0,
                  pointerEvents: 'none' as const,
                }),
              }
        }
        transition={{ duration: reduceMotion ? 0.18 : 0.48, ease: slideEase }}
        className="crm-reveal"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
