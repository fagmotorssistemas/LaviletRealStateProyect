'use client'

import { BellRing, Inbox } from 'lucide-react'
import { useVisitInboxContext } from '@/contexts/VisitInboxContext'

export function VisitInboxTrigger({ compact = false }: { compact?: boolean }) {
  const { pending, waiting, error, ready, openInbox, openRequest } = useVisitInboxContext()
  const attention = pending.length > 0
  const label = error ? 'Revisar bandeja' : pending.length === 1 ? `Cita pendiente: ${pending[0].lead?.name?.split(' ')[0] || 'Cliente'}` : attention ? 'Citas pendientes' : waiting.length ? 'Esperando al cliente' : 'Bandeja de citas'
  return (
    <button type="button" onClick={() => pending.length === 1 && !error ? openRequest(pending[0]) : openInbox(attention ? 'pending' : 'all')}
      aria-haspopup="dialog" aria-label={`${label}${ready ? `: ${pending.length} por atender, ${waiting.length} esperando al cliente` : ''}`}
      className={`inline-flex h-9 min-w-0 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 ${attention || error ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100' : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'}`}>
      {attention ? <BellRing size={15} className="appointment-notice-bell shrink-0" /> : <Inbox size={15} className="shrink-0" />}
      <span className={compact ? 'hidden' : 'hidden truncate lg:inline'}>{label}</span>
      <span aria-hidden="true" className={`rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${attention ? 'bg-amber-700 text-white' : 'bg-stone-100'}`}>{ready ? pending.length || waiting.length : '…'}</span>
    </button>
  )
}
