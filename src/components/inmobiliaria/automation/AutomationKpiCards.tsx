import { formatResponseMinutes } from '@/lib/inmobiliaria/leadAutomation'
import type { LeadAutomationKpis } from '@/types/leadAutomation'

interface AutomationKpiCardsProps {
  kpis: LeadAutomationKpis
}

const cards: { key: keyof Pick<LeadAutomationKpis, 'leads_new' | 'leads_cold' | 'leads_warm' | 'leads_hot' | 'handed_off' | 'visits_requested' | 'sla_overdue'>; label: string }[] = [
  { key: 'leads_new', label: 'Leads nuevos' },
  { key: 'leads_cold', label: 'Fríos' },
  { key: 'leads_warm', label: 'Tibios' },
  { key: 'leads_hot', label: 'Calientes' },
  { key: 'handed_off', label: 'Entregados a vendedora' },
  { key: 'visits_requested', label: 'Visitas solicitadas' },
  { key: 'sla_overdue', label: 'SLA vencidos' },
]

export function AutomationKpiCards({ kpis }: AutomationKpiCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
      {cards.map((card) => (
        <div key={card.key} className="crm-stat">
          <p className="crm-stat-label">{card.label}</p>
          <p className="crm-stat-value">{kpis[card.key]}</p>
        </div>
      ))}
      <div className="crm-stat">
        <p className="crm-stat-label">Tiempo promedio de respuesta</p>
        <p className="crm-stat-value">{formatResponseMinutes(kpis.avg_first_response_minutes)}</p>
      </div>
    </div>
  )
}
