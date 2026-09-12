'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { ArrowRight, CalendarDays, CheckCheck, Clock3, ExternalLink, Inbox, RefreshCw, Search, X } from 'lucide-react'
import { useVisitInboxContext, type VisitInboxTab } from '@/contexts/VisitInboxContext'
import { formatAgendaDateTime } from '@/lib/inmobiliaria/agendaTime'
import { kommoLeadUrl } from '@/lib/inmobiliaria/visitPresentation'
import { visitIsOverdue, visitWaitLabel } from '@/lib/inmobiliaria/visitInbox'

export function VisitInboxDrawer() {
  const { items, pending, waiting, overdue, now, tab, setTab, error, ready, loading, reload, closeInbox, openRequest, isAdmin } = useVisitInboxContext()
  const dialog = useRef<HTMLDialogElement>(null)
  const [search, setSearch] = useState('')
  useEffect(() => {
    const node = dialog.current
    node?.showModal()
    return () => node?.close()
  }, [])
  const base = tab === 'pending' ? pending : tab === 'waiting' ? waiting : items
  const query = search.trim().toLocaleLowerCase('es')
  const visible = base.filter(item => !query || [item.lead?.name, item.lead?.phone, item.project?.name, item.preferred_time_text].some(value => value?.toLocaleLowerCase('es').includes(query)))
  const tabs: { id: VisitInboxTab; label: string; count: number }[] = [
    { id: 'pending', label: 'Por atender', count: pending.length },
    { id: 'waiting', label: 'Espera al cliente', count: waiting.length },
    { id: 'all', label: 'Todas', count: items.length },
  ]
  return createPortal(
    <dialog ref={dialog} aria-labelledby="visit-inbox-title" onCancel={event => { event.preventDefault(); closeInbox() }}
      onClick={event => { if (event.target === event.currentTarget) closeInbox() }}
      className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full max-w-lg flex-col border-0 bg-[#fbfaf7] p-0 text-[#374139] shadow-2xl backdrop:bg-[#18251d]/35 open:flex">
      <div className="flex h-full min-h-0 flex-col">
        <header className="border-b border-stone-200 bg-white px-6 pt-6 pb-5">
          <div className="flex items-start justify-between gap-3">
            <div><p className="mb-1 text-[10px] font-semibold tracking-[0.18em] text-stone-500 uppercase">Atención comercial</p><h2 id="visit-inbox-title" className="font-display text-3xl">Bandeja de citas</h2></div>
            <button type="button" autoFocus onClick={closeInbox} aria-label="Cerrar bandeja de citas" className="rounded-lg p-2 hover:bg-stone-100 focus-visible:outline-2"><X size={20} /></button>
          </div>
          <p className="mt-2 text-sm text-stone-500">Todas las solicitudes abiertas, en un solo lugar.</p>
          <div className="mt-5 flex items-center justify-between gap-2 rounded-xl bg-[#f5f3ec] px-4 py-3">
            <span className="text-sm"><strong className="mr-2 text-xl tabular-nums">{ready ? pending.length : '—'}</strong> por atender</span>
            {overdue.length > 0 && <span className="text-xs font-semibold text-amber-800">{overdue.length} con plazo vencido</span>}
            <button type="button" disabled={loading} onClick={() => { void reload() }} aria-label="Actualizar citas" className="rounded-lg p-2 hover:bg-stone-200 disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button>
          </div>
          <div className="mt-4 flex gap-1" aria-label="Filtrar citas">
            {tabs.map(item => <button type="button" key={item.id} aria-pressed={tab === item.id} onClick={() => setTab(item.id)} className={`flex-1 rounded-lg px-2 py-2 text-xs transition-colors ${tab === item.id ? 'bg-[#23362c] text-white' : 'text-stone-600 hover:bg-stone-100'}`}>{item.label} <span className="ml-1 tabular-nums opacity-75">{item.count}</span></button>)}
          </div>
          <div className="relative mt-4"><Search size={15} className="absolute top-3 left-3 text-stone-400" /><input aria-label="Buscar en citas pendientes" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar cliente, teléfono o proyecto" className="h-10 w-full rounded-lg border border-stone-200 bg-white pr-3 pl-9 text-sm outline-none focus:border-[#787D62]" /></div>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          {error && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
          {!ready && <p role="status" className="py-12 text-center text-sm text-stone-500">Cargando solicitudes…</p>}
          {ready && !error && visible.length === 0 && <div className="py-14 text-center"><CheckCheck size={32} className="mx-auto mb-4 text-[#787D62]" /><h3 className="font-semibold">{search ? 'Sin coincidencias' : tab === 'pending' ? 'Todo al día' : 'No hay solicitudes en esta vista'}</h3><p className="mx-auto mt-2 max-w-xs text-sm text-stone-500">{search ? 'Pruebe con otro nombre o teléfono.' : 'Las nuevas solicitudes aparecerán aquí automáticamente.'}</p></div>}
          {visible.map(item => {
            const urgent = visitIsOverdue(item, now)
            const isPending = item.status === 'awaiting_advisor'
            const chat = kommoLeadUrl(item.lead?.kommo_id)
            return <article key={item.id} className={`rounded-xl border bg-white p-4 ${urgent ? 'border-amber-300' : 'border-stone-200'}`}>
              <div className="flex items-center justify-between gap-3 text-[11px]"><span className={`rounded-full px-2 py-1 font-semibold ${isPending ? 'bg-amber-50 text-amber-800' : 'bg-sky-50 text-sky-800'}`}>{urgent ? 'Requiere atención' : isPending ? 'Pendiente de revisión' : 'Esperando al cliente'}</span><span className="flex items-center gap-1 whitespace-nowrap text-stone-500"><Clock3 size={12} />{visitWaitLabel(item.created_at, now)}</span></div>
              <h3 className="mt-3 font-semibold">{item.lead?.name || 'Cliente sin nombre'}</h3>
              <p className="mt-0.5 text-xs text-stone-500">{item.project?.name || 'Proyecto'}{item.lead?.preferred_category ? ` · ${item.lead.preferred_category.replace(/_/g, ' ')}` : ''}</p>
              <div className="my-4 flex gap-3 rounded-lg bg-[#f8f8f4] px-3 py-3"><CalendarDays size={18} className="mt-1 shrink-0 text-[#787D62]" /><div><p className="text-[10px] tracking-wide text-stone-500 uppercase">{isPending ? 'Horario solicitado' : 'Horario propuesto'}</p><p className="mt-1 text-base font-semibold">{item.proposed_start_time ? formatAgendaDateTime(item.proposed_start_time) : item.preferred_time_text || 'Necesita una propuesta de horario'}</p></div></div>
              {isAdmin && <p className="mb-3 text-xs text-stone-500">Asesor: <span className="text-stone-700">{item.assigned_advisor?.full_name || 'Pendiente de asignación'}</span></p>}
              <div className="flex items-center justify-between gap-3">
                {chat ? <a href={chat} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-stone-600 hover:underline">Chat en Kommo <ExternalLink size={12} /></a> : <span />}
                <button type="button" onClick={() => openRequest(item)} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 ${isPending ? 'bg-[#23362c] text-white hover:bg-[#354b3e]' : 'border border-stone-200 text-stone-700 hover:bg-stone-50'}`}>{isPending ? 'Revisar cita' : 'Ver propuesta'}<ArrowRight size={14} /></button>
              </div>
            </article>
          })}
        </div>
        <footer className="flex items-center justify-between border-t border-stone-200 bg-white px-6 py-4 text-xs text-stone-500"><span className="flex items-center gap-2"><Inbox size={14} />{visible.length} solicitudes</span><Link href="/inmobiliaria/agenda" onClick={closeInbox} className="font-semibold text-[#374139] hover:underline">Ir a la agenda →</Link></footer>
      </div>
    </dialog>, document.body,
  )
}
