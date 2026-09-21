'use client'

import { useEffect, useRef, useState } from 'react'
import { Bell, CheckCheck, ExternalLink, RefreshCw, UserRound } from 'lucide-react'
import { useAdvisorNotifications } from '@/contexts/AdvisorNotificationsContext'
import { useAuth } from '@/contexts/AuthContext'
import { knownRole } from '@/lib/inmobiliaria/roleAccess'
import { kommoLeadUrl } from '@/lib/inmobiliaria/visitPresentation'
import type { AdvisorNotification } from '@/types/inmobiliaria'

function notificationDate(value: string) {
  return new Intl.DateTimeFormat('es-EC', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Guayaquil',
  }).format(new Date(value))
}

function notificationKommoId(item: AdvisorNotification) {
  const joined = Number(item.lead?.kommo_id)
  if (Number.isSafeInteger(joined) && joined > 0) return joined
  const metadata = Number(item.metadata?.kommo_id)
  return Number.isSafeInteger(metadata) && metadata > 0 ? metadata : null
}

export function AdvisorNotificationsTrigger({ compact = false }: { compact?: boolean }) {
  const { profile } = useAuth()
  const { items, unreadCount, ready, loading, error, reload, markRead, markAllRead } = useAdvisorNotifications()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const role = knownRole(profile?.role)
  const visible = items.slice(0, 10)

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  if (role !== 'asesor' && role !== 'admin') return null
  const active = unreadCount > 0
  const label = error
    ? 'Revisar notificaciones'
    : unreadCount === 1
      ? '1 notificación nueva'
      : unreadCount > 1
        ? `${unreadCount} notificaciones nuevas`
        : 'Notificaciones'

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
        onClick={() => {
          setOpen(value => !value)
          if (!open) void reload()
        }}
        className={`inline-flex h-9 min-w-0 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#607351] ${active || error ? 'border-[#b6c2aa] bg-[#eef2e8] text-[#3f5138] hover:bg-[#e4eadc]' : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'}`}
      >
        <Bell size={15} className={active ? 'fill-[#607351] text-[#607351]' : ''} />
        <span className={compact ? 'sr-only' : 'hidden truncate lg:inline'}>{label}</span>
        {(active || !ready) && (
          <span className={`rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${active ? 'bg-[#607351] text-white' : 'bg-stone-100'}`}>
            {ready ? unreadCount : '…'}
          </span>
        )}
      </button>

      {open && (
        <section
          role="dialog"
          aria-label="Últimas notificaciones"
          className="absolute top-[calc(100%+0.6rem)] right-0 z-[90] w-[min(25rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-stone-200 bg-white text-left text-stone-700 shadow-[0_18px_55px_rgba(45,50,42,0.2)]"
        >
          <header className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-[#374139]">Notificaciones</h2>
              <p className="mt-0.5 text-[11px] text-stone-500">
                {ready ? `${unreadCount} sin leer` : 'Cargando…'}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => { void markAllRead() }}
                  aria-label="Marcar todas como leídas"
                  title="Marcar todas como leídas"
                  className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 hover:text-[#374139]"
                >
                  <CheckCheck size={16} />
                </button>
              )}
              <button
                type="button"
                disabled={loading}
                onClick={() => { void reload() }}
                aria-label="Actualizar notificaciones"
                title="Actualizar"
                className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 hover:text-[#374139] disabled:opacity-50"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </header>

          <div className="max-h-[min(31rem,70vh)] overflow-y-auto">
            {error && (
              <p role="status" className="m-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                {error}
              </p>
            )}
            {!ready && (
              <p className="px-4 py-10 text-center text-sm text-stone-500">Cargando notificaciones…</p>
            )}
            {ready && !error && visible.length === 0 && (
              <div className="px-5 py-10 text-center">
                <CheckCheck size={28} className="mx-auto text-[#78886d]" />
                <p className="mt-3 text-sm font-semibold text-[#374139]">Todavía no hay notificaciones</p>
                <p className="mt-1 text-xs leading-relaxed text-stone-500">Las nuevas asignaciones de leads aparecerán aquí.</p>
              </div>
            )}
            {visible.map(item => {
              const kommoUrl = kommoLeadUrl(notificationKommoId(item))
              return (
                <article key={item.id} className={`border-b border-stone-100 px-4 py-3 last:border-b-0 ${item.read_at ? 'bg-white' : 'bg-[#f3f6ef]'}`}>
                  <div className="flex gap-3">
                    <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${item.read_at ? 'bg-stone-100 text-stone-500' : 'bg-[#607351] text-white'}`}>
                      {item.read_at ? <UserRound size={15} /> : <Bell size={14} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-sm font-semibold text-[#374139]">{item.title}</h3>
                        {!item.read_at && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#607351]" aria-label="Sin leer" />}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-stone-600">{item.body}</p>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <span className="text-[11px] text-stone-400">{notificationDate(item.created_at)}</span>
                        {kommoUrl ? (
                          <a
                            href={kommoUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={() => { void markRead(item.id) }}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-[#526346] hover:text-[#374139]"
                          >
                            Abrir lead <ExternalLink size={12} />
                          </a>
                        ) : !item.read_at ? (
                          <button type="button" onClick={() => { void markRead(item.id) }} className="text-xs font-semibold text-[#526346] hover:text-[#374139]">
                            Marcar leída
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
