export type CrmCapiSignalKind =
  | 'showroom_viewed'
  | 'unit_viewed'
  | 'information_requested'
  | 'wishlist_added'
  | 'initial_ctwa_interest'
  | 'crm_qualification'
  | 'appointment_confirmed'
  | 'sale_closed'

export type CrmCapiSignalContract = {
  kind: CrmCapiSignalKind
  evidence: string
  metaEventName:
    | 'ViewContent'
    | 'Lead'
    | 'AddToWishlist'
    | 'LeadSubmitted'
    | 'QualifiedLead'
    | 'Schedule'
    | 'Purchase'
  actionSource: 'business_messaging' | 'website' | 'system_generated'
  dataset: 'messaging' | 'web'
  idempotency: string
  repetition: string
  enabled: boolean
}

export const CRM_CAPI_SIGNAL_MATRIX: CrmCapiSignalContract[] = [
  {
    kind: 'showroom_viewed',
    evidence: 'Showroom 360 realmente listo',
    metaEventName: 'ViewContent',
    actionSource: 'website',
    dataset: 'web',
    idempotency: 'view:showroom:{visitor_key}',
    repetition: 'Una vez por visitante/showroom según contrato existente',
    enabled: true,
  },
  {
    kind: 'unit_viewed',
    evidence: 'Ficha de unidad realmente abierta',
    metaEventName: 'ViewContent',
    actionSource: 'website',
    dataset: 'web',
    idempotency: 'view:{visitor_key}:{unit_id}',
    repetition: 'Una vez por visitante y unidad',
    enabled: true,
  },
  {
    kind: 'information_requested',
    evidence: 'Solicitud de información persistida',
    metaEventName: 'Lead',
    actionSource: 'website',
    dataset: 'web',
    idempotency: 'lead:{lead_id}',
    repetition: 'Una vez por solicitud/lead',
    enabled: true,
  },
  {
    kind: 'wishlist_added',
    evidence: 'Favorito realmente guardado',
    metaEventName: 'AddToWishlist',
    actionSource: 'website',
    dataset: 'web',
    idempotency: 'wishlist:{lead_id}:{unit_id}',
    repetition: 'Una vez por lead y unidad',
    enabled: true,
  },
  {
    kind: 'initial_ctwa_interest',
    evidence: 'Interés comercial CTWA elegible y atribución original',
    metaEventName: 'LeadSubmitted',
    actionSource: 'business_messaging',
    dataset: 'messaging',
    idempotency: 'wa_lead_submitted:{lead_id}',
    repetition: 'Una vez por adquisición/lead',
    enabled: false,
  },
  {
    kind: 'crm_qualification',
    evidence: 'Primera evaluación persistida tibia o caliente con transición registrada',
    metaEventName: 'QualifiedLead',
    actionSource: 'business_messaging',
    dataset: 'messaging',
    idempotency: 'wa_crm_qualified:{lead_id}',
    repetition:
      'Una vez por calificación del lead; cambiar etiqueta o temperatura no crea otro hecho',
    enabled: false,
  },
  {
    kind: 'appointment_confirmed',
    evidence: 'Cita persistida, estado confirmado y confirmed_by_client=true',
    metaEventName: 'Schedule',
    actionSource: 'website',
    dataset: 'web',
    idempotency: 'schedule:{appointment_id}',
    repetition: 'Una vez por cita confirmada; reprogramar la misma cita conserva identidad',
    enabled: false,
  },
  {
    kind: 'sale_closed',
    evidence: 'Cierre real persistido con fechas, valor y moneda verificables',
    metaEventName: 'Purchase',
    actionSource: 'system_generated',
    dataset: 'web',
    idempotency: 'purchase:{sale_id}',
    repetition: 'Una vez por cierre de venta',
    enabled: false,
  },
]

export type QualificationEvidenceLabel =
  | 'financiamiento'
  | 'interes_en_tipo_de_unidad'
  | 'cita_solicitada'
  | 'cita_confirmada'
  | `otro_motivo_registrado:${string}`

export function qualificationEvidenceLabels(events: string[]): QualificationEvidenceLabel[] {
  return [
    ...new Set(
      events.map((event): QualificationEvidenceLabel => {
        if (event === 'asked_financing') return 'financiamiento'
        if (event === 'declared_unit_type') return 'interes_en_tipo_de_unidad'
        if (event === 'requested_visit') return 'cita_solicitada'
        if (event === 'confirmed_visit') return 'cita_confirmada'
        return `otro_motivo_registrado:${event}`
      }),
    ),
  ].sort()
}

export type CommercialFact = {
  kind: CrmCapiSignalKind
  sourceId: string
  leadId: string
  occurredAt: string
}

export function commercialFactKey(fact: CommercialFact): string {
  if (fact.kind === 'crm_qualification') return `wa_crm_qualified:${fact.leadId}`
  if (fact.kind === 'appointment_confirmed') return `schedule:${fact.sourceId}`
  if (fact.kind === 'sale_closed') return `purchase:${fact.sourceId}`
  if (fact.kind === 'initial_ctwa_interest') return `wa_lead_submitted:${fact.leadId}`
  return `${fact.kind}:${fact.sourceId}`
}

export function distinctCommercialFacts(facts: CommercialFact[]): CommercialFact[] {
  const unique = new Map<string, CommercialFact>()
  for (const fact of facts)
    if (!unique.has(commercialFactKey(fact))) unique.set(commercialFactKey(fact), fact)
  return [...unique.values()]
}
