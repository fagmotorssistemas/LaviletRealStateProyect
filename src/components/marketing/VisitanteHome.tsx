'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { Menu, X } from 'lucide-react'
import { TourSafeArea } from '@/components/tour/TourSafeArea'
import { useAuth } from '@/contexts/AuthContext'
import { HOME_TABS, isHomeTab, type HomeTabId } from '@/lib/marketing/homeTabs'
import { cn } from '@/lib/utils'
import { ContactoPanel, NosotrosPanel, ProcesoPanel, ProyectosPanel } from './HomeInfoPanels'

const tabClass = (active: boolean) =>
  cn(
    'relative text-[11px] font-medium tracking-[0.22em] uppercase transition-colors',
    active ? 'text-[#2B1A18]' : 'text-[#2B1A18]/55 hover:text-[#2B1A18]',
  )

export function VisitanteHome() {
  const { supabase, profile } = useAuth()
  const [tab, setTab] = useState<HomeTabId>('proyectos')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const hash = window.location.hash.replace('#', '')
    if (isHomeTab(hash)) setTab(hash)
  }, [])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  const goTab = (next: HomeTabId) => {
    setTab(next)
    setOpen(false)
    window.history.replaceState(null, '', `#${next}`)
    document.getElementById('info')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const logout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  return (
    <div className="min-h-screen bg-[#f7f3ee] text-[#2B1A18]">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-[#2B1A18]/8 bg-[#f7f3ee]/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-6 px-5 sm:px-8 lg:px-12">
          <button
            type="button"
            className="text-[11px] font-medium tracking-[0.28em] text-[#2B1A18] uppercase"
            onClick={() => {
              setOpen(false)
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
          >
            Lavilet
          </button>

          <nav className="hidden items-center gap-8 md:flex" aria-label="Información">
            {HOME_TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => goTab(item.id)}
                className={tabClass(tab === item.id)}
              >
                {item.label}
                {tab === item.id && (
                  <span className="absolute inset-x-0 -bottom-2 h-px bg-[#BDA27E]" aria-hidden />
                )}
              </button>
            ))}
          </nav>

          <div className="hidden items-center gap-6 md:flex">
            <span className="max-w-[10rem] truncate text-[11px] font-medium tracking-[0.14em] text-[#2B1A18]/40 uppercase">
              {profile?.full_name?.split(/\s+/)[0] || 'Visitante'}
            </span>
            <button
              type="button"
              onClick={() => void logout()}
              className="text-[11px] font-medium tracking-[0.18em] text-[#2B1A18]/40 uppercase hover:text-[#2B1A18]"
            >
              Salir
            </button>
          </div>

          <button
            type="button"
            className="rounded-lg p-2 text-[#2B1A18] md:hidden"
            aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        {open && (
          <div className="border-t border-[#2B1A18]/10 bg-[#f7f3ee] px-5 pb-6 pt-2 md:hidden">
            <nav className="flex flex-col gap-1">
              {HOME_TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => goTab(item.id)}
                  className={cn(
                    'rounded-lg px-3 py-3 text-left text-sm tracking-[0.18em] uppercase',
                    tab === item.id ? 'bg-[#2B1A18]/5 text-[#2B1A18]' : 'text-[#2B1A18]/70',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <button
              type="button"
              onClick={() => void logout()}
              className="mt-4 px-3 py-2 text-sm tracking-[0.18em] text-[#2B1A18]/40 uppercase"
            >
              Salir
            </button>
          </div>
        )}
      </header>

      <section className="bg-[#f7f3ee] pt-16">
        <div className="mx-auto max-w-[1400px] px-5 pt-8 pb-5 sm:px-8 lg:px-12">
          <p className="text-[11px] font-medium tracking-[0.28em] text-[#BDA27E] uppercase">Showroom virtual</p>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Recorre el showroom en 360°</h1>
          <p className="mt-3 max-w-2xl text-sm text-[#2B1A18]/65 sm:text-base">
            Entra a las tipologías, cambia de ambiente y quédate donde más te interese. Abajo tienes el
            resto de la información.
          </p>
        </div>
        <div className="mx-auto max-w-[1400px] px-5 pb-10 sm:px-8 lg:px-12">
          <div className="h-[min(78vh,760px)] min-h-[420px] overflow-hidden rounded-2xl bg-black shadow-sm ring-1 ring-[#2B1A18]/8">
            <TourSafeArea embedded />
          </div>
        </div>
      </section>

      <section id="info" className="scroll-mt-20 border-t border-[#2B1A18]/8 bg-[#f7f3ee]">
        <div className="mx-auto max-w-[1400px] px-5 sm:px-8 lg:px-12">
          <div
            className="flex gap-6 overflow-x-auto border-b border-[#2B1A18]/8 py-4 md:hidden"
            role="tablist"
            aria-label="Información"
          >
            {HOME_TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => goTab(item.id)}
                className={cn(tabClass(tab === item.id), 'shrink-0 pb-1')}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="py-12 lg:py-16">
            {tab === 'proyectos' && <ProyectosPanel />}
            {tab === 'nosotros' && <NosotrosPanel />}
            {tab === 'proceso' && <ProcesoPanel onAgendar={() => goTab('contacto')} />}
            {tab === 'contacto' && <ContactoPanel />}
          </div>
        </div>
      </section>

      <footer className="border-t border-[#2B1A18]/10 bg-white py-8">
        <div className="mx-auto flex max-w-[1400px] flex-col items-center justify-between gap-4 px-5 sm:flex-row sm:px-8 lg:px-12">
          <Image
            src="/LogoHorizontal.png"
            alt="Lavilet"
            width={140}
            height={42}
            className="h-9 w-auto object-contain"
          />
          <p className="text-xs text-[#2B1A18]/45">
            © {new Date().getFullYear()} Lavilet. Todos los derechos reservados.
          </p>
        </div>
      </footer>
    </div>
  )
}
