'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { LogOut, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'

export function InmobiliariaAccountMenu() {
  const pathname = usePathname()
  const router = useRouter()
  const { supabase, profile } = useAuth()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex cursor-pointer items-center gap-2 px-3 py-2 text-[13px] font-semibold tracking-[0.14em] uppercase transition-colors',
          open ? 'text-white' : 'text-[#f4f4ef]/85 hover:text-white',
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Cuenta"
      >
        <Settings size={18} strokeWidth={1.75} className="shrink-0 text-[#c5c8bc]" />
        <span className="hidden truncate sm:inline">Cuenta</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            role="menu"
            className="absolute right-0 z-50 mt-2 w-64 origin-top-right overflow-hidden rounded-xl border border-[#c5c8bc] bg-white py-1.5 shadow-[0_16px_36px_rgba(85,92,74,0.16)]"
          >
            <div className="border-b border-[#e2e4dc] px-3.5 py-2.5">
              <p className="truncate text-sm font-medium text-[#3a3d36]">
                {profile?.full_name || 'Usuario'}
              </p>
              {profile?.email && (
                <p className="truncate text-xs text-[#8a8278]">{profile.email}</p>
              )}
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={handleLogout}
              className="flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-left text-sm font-medium text-[#5c6156] transition-colors hover:bg-[#e8e9e3] hover:text-[#3a3d36]"
            >
              <LogOut size={16} className="shrink-0" />
              Cerrar sesión
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
