import { CalendarCheck2, Flame, Timer, UserRoundPlus, UsersRound } from 'lucide-react'
import { formatResponseMinutes } from '@/lib/inmobiliaria/leadAutomation'
import type { LeadAutomationKpis } from '@/types/leadAutomation'
import styles from './AutomationWorkspace.module.css'

export function AutomationKpiCards({ kpis, loading = false }: { kpis: LeadAutomationKpis; loading?: boolean }) {
  const cards = [
    { label: 'Leads nuevos', value: kpis.leads_new, unit: 'leads', detail: `${kpis.leads_cold} fríos en seguimiento`, icon: UserRoundPlus },
    { label: 'Traspasos en espera', value: kpis.queued, unit: 'en cola', detail: `${kpis.handed_off} entregados al equipo`, icon: UsersRound, attention: kpis.queued > 0 },
    { label: 'Tibios y calientes', value: kpis.leads_warm + kpis.leads_hot, unit: 'leads', detail: `${kpis.leads_warm} tibios · ${kpis.leads_hot} calientes`, icon: Flame },
    { label: 'Citas confirmadas', value: kpis.visits_confirmed, unit: 'citas', detail: `${kpis.visits_requested} solicitudes registradas`, icon: CalendarCheck2 },
    { label: 'Plazos de respuesta', value: kpis.sla_overdue, unit: 'vencidos', detail: `Respuesta promedio: ${formatResponseMinutes(kpis.avg_first_response_minutes)}`, icon: Timer, attention: kpis.sla_overdue > 0 },
  ]
  return <section aria-label="Indicadores de automatización" className={styles.kpis}>
    {cards.map(({ label, value, unit, detail, icon: Icon, attention }) => <article key={label} className={`${styles.kpi} ${attention ? styles.kpiAttention : ''}`}>
      <div className={styles.kpiLabel}>{label}<Icon size={16} strokeWidth={1.5} /></div>
      <p className={styles.kpiValue}>{loading ? '—' : value}<small>{unit}</small></p>
      <p className={styles.kpiFooter}>{loading ? 'Cargando indicadores…' : detail}</p>
    </article>)}
  </section>
}
