import { bucketTemp, type TemperatureBucket } from './marketingFunnel.logic'
export type InterestEvidence = {bucket:TemperatureBucket; evaluatedAt:string|null; score:number|null; reason:string}
export function currentInterest(lead:{temperature?:string|null;temperature_updated_at?:string|null;temperature_score?:number|null},reasons:string[]=[]):InterestEvidence {
  const evaluatedAt=lead.temperature_updated_at && Number.isFinite(Date.parse(lead.temperature_updated_at))?lead.temperature_updated_at:null
  // Match LeadsList / LeadDetailModal: current CRM label, including their cold fallback.
  // A missing evaluation date does not change the label or create evaluation evidence.
  const bucket=bucketTemp(lead.temperature || 'frio')
  return {bucket,evaluatedAt,score:lead.temperature_score ?? null,reason:reasons.length?Array.from(new Set(reasons)).join('; '):evaluatedAt?'Clasificación actual del CRM; no hay un motivo detallado disponible.':'Clasificación mostrada en Contactos, sin fecha ni motivo de evaluación registrados.'}
}
export function interestGroups(ids:string[],evidence:Record<string,InterestEvidence>={}) {
  const groups:Record<TemperatureBucket,string[]>={frio:[],tibio:[],caliente:[],sin_clasificar:[]}
  for(const id of new Set(ids)) groups[evidence[id]?.bucket || 'sin_clasificar'].push(id)
  return groups
}
