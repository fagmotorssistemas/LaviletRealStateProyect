'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowUpRight,
  CircleUserRound,
  Clock3,
  ExternalLink,
  Inbox,
  MessageCircleMore,
  Play,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  advisorAttentionPriority,
  advisorAttentionTitle,
  advisorAttentionView,
  advisorAttentionWaitLabel,
  type AdvisorAttentionView,
} from '@/lib/inmobiliaria/advisorAttention'
import { formatAgendaDateTime } from '@/lib/inmobiliaria/agendaTime'
import type { LeadAttentionRow } from '@/types/leadAutomation'
import styles from './AutomationWorkspace.module.css'

const VIEWS: { id: AdvisorAttentionView; label: string }[] = [
  { id: 'pending', label: 'Requieren atención' },
  { id: 'mine', label: 'Asignados a mí' },
]

const PRIORITY_LABEL = { high: 'Alta', medium: 'Media', normal: 'Normal' }
const PRIORITY_ORDER = { high: 0, medium: 1, normal: 2 }

function kommoLeadUrl(id: number | null) {
  return id ? `https://lavilet.kommo.com/leads/detail/${id}` : null
}

export function AdvisorAttentionQueue({ rows, currentUserId, loading, onOpenLead, onOpenVisitInbox, onChanged }: {
  rows: LeadAttentionRow[]
  currentUserId: string
  loading: boolean
  onOpenLead: (leadId: string) => void
  onOpenVisitInbox: () => void
  onChanged: () => Promise<void>
}) {
  const [active, setActive] = useState<AdvisorAttentionView>('pending')
  const [updating, setUpdating] = useState<string | null>(null)
  const grouped = useMemo(() => {
    const result: Record<AdvisorAttentionView, LeadAttentionRow[]> = { pending: [], mine: [] }
    for (const row of rows) {
      const view = advisorAttentionView(row, currentUserId)
      if (view) result[view].push(row)
    }
    for (const view of VIEWS) result[view.id].sort((a, b) => {
      const priority = PRIORITY_ORDER[advisorAttentionPriority(a)] - PRIORITY_ORDER[advisorAttentionPriority(b)]
      if (priority) return priority
      return Date.parse(a.handoff_requested_at ?? '') - Date.parse(b.handoff_requested_at ?? '')
    })
    return result
  }, [currentUserId, rows])
  const visible = grouped[active]

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void onChanged() }
    const timer = window.setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [onChanged])

  const claim = async (row: LeadAttentionRow) => {
    const action = 'claim'
    setUpdating(`${row.lead_id}:${action}`)
    try {
      const response = await fetch('/api/inmobiliaria/automation/attention', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: row.lead_id, action }),
      })
      const body = await response.json() as { error?: string }
      if (!response.ok) throw new Error(body.error || 'No se pudo actualizar la atención')
      toast.success('Lead asignado')
      await onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar la atención')
    } finally {
      setUpdating(null)
    }
  }

  return <section className={styles.attentionQueue} aria-labelledby="advisor-attention-title">
    <header className={styles.queueHeader}>
      <div>
        <p className={styles.queueEyebrow}>Trabajo del equipo</p>
        <h2 id="advisor-attention-title">Bandeja de atención</h2>
        <p>Ordena los traspasos por prioridad y permite saber quién debe responder.</p>
      </div>
      <span className={styles.queueTotal}>{grouped.pending.length + grouped.mine.length} activos</span>
    </header>

    <nav className={styles.queueTabs} aria-label="Estados de atención">
      {VIEWS.map((view) => <button key={view.id} type="button" aria-pressed={active === view.id} onClick={() => setActive(view.id)}>
        <span>{view.label}</span><strong>{grouped[view.id].length}</strong>
      </button>)}
    </nav>

    <div className={styles.queueList} aria-live="polite" aria-busy={loading}>
      {loading ? <div className={styles.queueEmpty}><Clock3 size={18} />Actualizando la bandeja…</div>
        : visible.length === 0 ? <div className={styles.queueEmpty}><Inbox size={18} />No hay leads en este estado.</div>
          : visible.map((row) => {
            const priority = advisorAttentionPriority(row)
            const kommoUrl = kommoLeadUrl(row.lead_kommo_id)
            const hasPendingVisit = ['solicitada', 'pendiente'].includes(String(row.last_visit_status ?? ''))
            const requestedAt = row.handoff_requested_at ?? row.last_interaction_at
            const currentAction = updating?.startsWith(`${row.lead_id}:`) === true
            return <article key={row.lead_id} className={styles.queueItem} data-priority={priority}>
              <div className={styles.queuePriority}><i /><span>{PRIORITY_LABEL[priority]}</span></div>
              <div className={styles.queueLead}>
                <div className={styles.queueLeadTitle}>
                  <button type="button" onClick={() => onOpenLead(row.lead_id)}>{row.name || 'Lead sin nombre'} <ArrowUpRight size={12} /></button>
                  <span>{advisorAttentionTitle(row.handoff_reason)}</span>
                </div>
                <p className={styles.queueMessage}>{row.last_customer_message || row.handoff_reason || 'Consulta pendiente de revisión.'}</p>
                {row.last_customer_message && row.handoff_reason && <p className={styles.queueReason}>Motivo: {row.handoff_reason}</p>}
              </div>
              <div className={styles.queueMeta}>
                <span><Clock3 size={12} />{advisorAttentionWaitLabel(requestedAt)}</span>
                <span><CircleUserRound size={12} />{row.assignee_name || 'Sin asignar'}</span>
                {row.project_name && <small>{row.project_name}</small>}
                {row.seller_response_due_at && <small>Plazo: {formatAgendaDateTime(row.seller_response_due_at)}</small>}
              </div>
              <div className={styles.queueActions}>
                {active === 'pending' && row.handoff_status === 'queued' && !row.assigned_to && <button type="button" className={styles.primary} disabled={currentAction} onClick={() => void claim(row)}><Play size={12} />Tomar</button>}
                {hasPendingVisit && <button type="button" onClick={onOpenVisitInbox}><MessageCircleMore size={12} />Bandeja de citas</button>}
                <button type="button" onClick={() => onOpenLead(row.lead_id)}>Detalle</button>
                {kommoUrl && <a href={kommoUrl} target="_blank" rel="noreferrer">Abrir en Kommo<ExternalLink size={11} /></a>}
              </div>
            </article>
          })}
    </div>
    <footer className={styles.queueNote}>La bandeja se actualiza cada 30 segundos. La automatización reparte los leads entre los asesores habilitados del proyecto. Asignar un lead no desactiva la IA.</footer>
  </section>
}
