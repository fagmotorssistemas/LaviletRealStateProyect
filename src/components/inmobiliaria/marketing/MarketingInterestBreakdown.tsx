'use client'
import { interestGroups, type InterestEvidence } from '@/services/marketingInterest.logic'
import { MetricHelp } from './AccessibleMetricHelp'
const labels={sin_clasificar:'Sin evaluar',frio:'Fríos',tibio:'Tibios',caliente:'Calientes'} as const
export function MarketingInterestBreakdown({ids,evidence,onOpen}:{ids:string[];evidence?:Record<string,InterestEvidence>;onOpen?:(ids:string[],title:string)=>void}) {
  const groups=interestGroups(ids,evidence)
  return <div className="flex flex-wrap gap-3 text-xs" aria-label="Nivel de interés actual">
    <span>Nivel de interés actual<MetricHelp label="Nivel de interés actual" description="Clasificación actual del CRM de los contactos adquiridos en el período elegido. Cada persona aparece una sola vez. Sin evaluar significa que no hay fecha de cálculo; no equivale a interés bajo. Los puntos proceden de acciones registradas, no de respuestas del bot. No describe cómo era su interés cuando llegó." /></span>
    {Object.entries(labels).map(([key,label])=><button key={key} type="button" className="underline" onClick={()=>onOpen?.(groups[key as keyof typeof groups],label)}>{label}: {groups[key as keyof typeof groups].length}</button>)}
  </div>
}
