'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronDown, LogOut, User } from 'lucide-react'
import { cn, getInitials } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { roleLabel } from '@/lib/inmobiliaria/roleAccess'

export function InmobiliariaAccountMenu({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const pathname = usePathname()
  const { supabase, profile } = useAuth()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  const onDark = tone === 'dark'
  const fullName = profile?.full_name?.trim() || 'Usuario'
  const firstName = fullName.split(/\s+/)[0]
  const initials = getInitials(fullName)

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.assign('/login')
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

  const avatar = (
    <span
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-medium tracking-wide',
        onDark ? 'bg-white/15 text-white' : 'bg-[#787D62] text-white',
      )}
    >
      {profile?.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
      ) : (
        <User size={15} strokeWidth={1.6} />
      )}
    </span>
  )

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex cursor-pointer items-center gap-2 rounded-full py-1 pr-1.5 pl-1 transition-colors',
          onDark
            ? open
              ? 'bg-white/15 text-white'
              : 'text-white/90 hover:bg-white/10'
            : open
              ? 'bg-white text-[#787D62] shadow-sm ring-1 ring-[#787D62]/15'
              : 'text-[#787D62] hover:bg-white/70',
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        title={fullName}
      >
        {avatar}
        <span className="hidden max-w-[9rem] truncate text-[12px] font-medium tracking-[0.08em] sm:inline">
          {firstName}
        </span>
        <ChevronDown
          size={14}
          strokeWidth={1.75}
          className={cn('mr-1 hidden shrink-0 sm:block', open && 'rotate-180')}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            role="menu"
            className="absolute right-0 z-50 mt-2 w-64 origin-top-right overflow-hidden rounded-2xl bg-white py-1.5 shadow-[0_18px_40px_rgba(43,26,24,0.12)] ring-1 ring-[#2B1A18]/8"
          >
            <div className="flex items-center gap-3 border-b border-[#2B1A18]/8 px-3.5 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#787D62] text-[10px] font-medium text-white">
                {profile?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  initials
                )}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[#555850]">{fullName}</p>
                {profile?.email && (
                  <p className="truncate text-xs font-medium text-[#8a8d87]">{profile.email}</p>
                )}
                {profile?.role && (
                  <p className="truncate text-[11px] font-medium tracking-[0.08em] text-[#9a7d55] uppercase">
                    {roleLabel(profile.role)}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={handleLogout}
              className="flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-left text-sm font-medium text-[#6e716b] transition-colors hover:bg-[#f7f3ee] hover:text-[#555850]"
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
