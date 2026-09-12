'use client'

import { ArrowUpRight, TriangleAlert } from 'lucide-react'
import { purposeLabel, sourceLabel, stageLabel, handoffLabel, slaLabel } from '@/lib/inmobiliaria/leadAutomation'
import { formatAgendaDateTime } from '@/lib/inmobiliaria/agendaTime'
import type { LeadAutomationRow } from '@/types/leadAutomation'
import styles from './AutomationWorkspace.module.css'

const temperatures = { frio: 'Frío', tibio: 'Tibio', caliente: 'Caliente' }
const categories: Record<string, string> = { departamento: 'Departamento', suite: 'Suite', local: 'Local comercial', local_comercial: 'Local comercial' }

export function AutomationLeadsTable({ rows, selectedLeadId, onSelect }: {
  rows: LeadAutomationRow[]; selectedLeadId: string | null; onSelect: (leadId: string) => void
}) {
  return <table className={styles.table}>
    <caption className="sr-only">Leads de automatización. Seleccione un nombre para ver la conversación y el detalle.</caption>
    <colgroup><col style={{ width: '27%' }} /><col style={{ width: '18%' }} /><col style={{ width: '15%' }} /><col style={{ width: '20%' }} /><col style={{ width: '20%' }} /></colgroup>
    <thead><tr><th scope="col">Lead y contacto</th><th scope="col">Interés y propósito</th><th scope="col">Calificación</th><th scope="col">Etapa y bot</th><th scope="col">Responsable y respuesta</th></tr></thead>
    <tbody>{rows.map(row => {
      const heat = row.temperature === 'caliente' ? 3 : row.temperature === 'tibio' ? 2 : 1
      const initials = row.name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('')
      return <tr key={row.lead_id} data-selected={selectedLeadId === row.lead_id}>
        <td><div className={styles.person}><span className={styles.avatar} aria-hidden="true">{initials || 'L'}</span><div className="min-w-0">
          <button type="button" className={styles.name} onClick={() => onSelect(row.lead_id)}>{row.name || 'Sin nombre'} <ArrowUpRight size={12} className="ml-1 inline opacity-40" /></button>
          <p className={styles.secondary}>{row.phone || 'Sin teléfono'}<br />{sourceLabel(row.source)}</p>
          {row.project_name && <p className={styles.secondary}>{row.project_name}</p>}
        </div></div></td>
        <td data-label="Interés"><p>{categories[row.preferred_category ?? ''] || row.preferred_category || 'Por definir'}</p><p className={styles.secondary}>{purposeLabel(row.purchase_purpose)}</p>
          {row.last_visit_status && <span className={`${styles.miniBadge} mt-2`}>{({ solicitada: 'Visita solicitada', pendiente: 'Visita pendiente', aceptado: 'Cita confirmada', reprogramado: 'Cita reprogramada', atendido: 'Visita realizada', cancelado: 'Cita cancelada' } as Record<string, string>)[row.last_visit_status] || 'Con solicitud de visita'}</span>}
        </td>
        <td data-label="Calificación"><div className={styles.score}>{temperatures[row.temperature] || 'Por calificar'}<span>{row.score} pts</span></div><div className={styles.heat} data-temperature={row.temperature} aria-hidden="true">{[1, 2, 3].map(level => <i key={level} data-filled={level <= heat} />)}</div></td>
        <td data-label="Etapa y bot"><p>{stageLabel(row.stage)}</p><span className={styles.bot} data-active={row.bot_enabled}><i aria-hidden="true" />{row.bot_enabled ? 'Bot activo' : 'Bot detenido'}</span><p className={styles.secondary}>Última interacción<br />{row.last_interaction_at ? formatAgendaDateTime(row.last_interaction_at) : 'Sin interacción'}</p></td>
        <td data-label="Responsable"><p className="font-medium">{row.assignee_name || <span className={styles.miniBadge}><TriangleAlert size={11} />Sin asignar</span>}</p>
          {row.handoff_status !== 'none' && <p className={styles.secondary}>{handoffLabel(row.handoff_status)}</p>}
          {row.sla_status !== 'no_aplica' && <p className={`mt-2 text-[10px] ${row.sla_status === 'vencido' ? 'font-semibold text-amber-800' : 'text-stone-500'}`}>{row.sla_status === 'vencido' ? 'Respuesta vencida' : `Respuesta: ${slaLabel(row.sla_status)}`}</p>}
          {row.sla_status !== 'respondido' && row.seller_response_due_at && <p className={styles.secondary}>{formatAgendaDateTime(row.seller_response_due_at)}</p>}
        </td>
      </tr>
    })}</tbody>
  </table>
}
