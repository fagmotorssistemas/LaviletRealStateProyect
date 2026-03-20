'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import {
  UserPlus,
  Landmark,
  CalendarDays,
  LayoutGrid,
  FileText,
  Menu,
  X,
  LogOut,
  ChevronLeft,
  Building2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'

const menuItems = [
  { label: 'Inventario', href: '/inmobiliaria/inventario', icon: LayoutGrid },
  { label: 'Leads', href: '/inmobiliaria/leads', icon: UserPlus },
  { label: 'Showroom', href: '/inmobiliaria/showroom', icon: Landmark },
  { label: 'Agenda', href: '/inmobiliaria/agenda', icon: CalendarDays },
  { label: 'Contratos', href: '/inmobiliaria/contratos', icon: FileText },
]

export function InmobiliariaSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { supabase, profile } = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <>
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-50 rounded-lg bg-white p-2 shadow-md md:hidden cursor-pointer"
      >
        <Menu size={22} className="text-[#2B1A18]" />
      </button>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed top-0 left-0 z-50 flex h-full flex-col bg-white border-r border-[#BDA27E]/20 transition-all duration-300 md:relative md:z-auto',
          collapsed ? 'w-20' : 'w-62',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-[#BDA27E]/20">
          {!collapsed ? (
            <Image
              src="/LogoHorizontal.png"
              alt="Lavilet"
              width={160}
              height={48}
              className="h-18 w-auto object-contain"
              preload
            />
          ) : (
            <div className="mx-auto flex h-10 w-10 items-center justify-center">
              <Building2 size={22} className="text-[#2B1A18]" />
            </div>
          )}
          <button
            onClick={() => { setCollapsed(!collapsed); setMobileOpen(false) }}
            className="rounded-lg p-1.5 text-[#BDA27E] hover:bg-[#BDA27E]/10 transition-colors cursor-pointer hidden md:block"
          >
            {collapsed ? <Menu size={20} /> : <ChevronLeft size={20} />}
          </button>
          <button
            onClick={() => setMobileOpen(false)}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 transition-colors cursor-pointer md:hidden"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {menuItems.map((item) => {
            const isActive = pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
                  isActive
                    ? 'bg-[#2B1A18] text-white shadow-sm'
                    : 'text-[#2B1A18]/70 hover:bg-[#BDA27E]/10 hover:text-[#2B1A18]'
                )}
              >
                <item.icon size={20} />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            )
          })}
        </nav>

        <div className="border-t border-[#BDA27E]/20 p-3">
          {!collapsed && profile && (
            <div className="mb-3 px-3">
              <p className="text-sm font-medium text-[#2B1A18] truncate">
                {profile.full_name || 'Usuario'}
              </p>
              <p className="text-xs text-[#BDA27E] truncate">{profile.email}</p>
            </div>
          )}
          <button
            onClick={handleLogout}
            className={cn(
              'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[#2B1A18]/60 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer',
              collapsed && 'justify-center'
            )}
          >
            <LogOut size={20} />
            {!collapsed && <span>Cerrar sesión</span>}
          </button>
        </div>
      </aside>
    </>
  )
}
