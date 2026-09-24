/**
 * Contrato de entrega CAPI para el panel CRM.
 * Distingue: recepción Nest ≠ aceptación Graph ≠ atribución a campaña.
 * No marca históricos como aceptados sin evidencia (conversion_log o Nest lookup).
 */

export type MetaCapiDeliveryOutcome =
  | 'pending'
  | 'backend_accepted'
  | 'transport_failed'
  | 'meta_rejected'
  | 'meta_unverified'
  | 'nest_received'
  | 'meta_accepted'
  | 'blocked'
  | 'failed_retrying'
  | 'unknown'
  | 'cancelled'
  /** Captura local / CRM sin envío CAPI. */
  | 'internal_activity'
  /** Outbox retenido: Nest tipado aún no acepta el event_name. */
  | 'pending_backend_support'

export type MetaCapiStatusBucket =
  | 'all'
  | MetaCapiDeliveryOutcome
  /** @deprecated Prefer nest_received */
  | 'delivered_backend'
  /** @deprecated Prefer blocked */
  | 'blocked_config'
  | 'retained'
  | 'cancelled'
  /** @deprecated Prefer failed_retrying */
  | 'failed'

export type ConversionLogEvidence = {
  stage: string
  reason: string | null
  createdAt: string
  fbtraceId: string | null
  eventsReceived: number | null
  httpStatus: number | null
  datasetId: string | null
  attributionVerified?: boolean
  metaAttributed?: boolean
  attributedAdSetId?: string | null
}

export type NestEventLookupEvidence = {
  found: boolean
  status: string | null
  attemptCount: number | null
  lastError: string | null
  deliveryLane: string | null
  datasetId: string | null
  sentAt: string | null
  apiAccepted: boolean
  acceptanceTier: string | null
  eventsReceived: number | null
  fbtraceId: string | null
  httpStatus: number | null
  lookupOk: boolean
  deliveryOutcome?: string | null
}

export type DeliveryOutcomeResult = {
  outcome: MetaCapiDeliveryOutcome
  label: string
  /** Motivo legible (bloqueo / fallo / desconocido). */
  reason: string | null
  /** Evidencia Graph si outcome=meta_accepted. */
  graphEvidence: {
    fbtraceId: string | null
    eventsReceived: number | null
    httpStatus: number | null
    source: 'conversion_log' | 'nest_lookup'
  } | null
  /** Compat con columna recepción previa. */
  receptionLabel: string
}

function hasMetaAcceptedEvidence(log: ConversionLogEvidence | null): boolean {
  if (!log || log.stage !== 'meta_accepted') return false
  // Exigir evidencia mínima: events_received>=1 o fbtrace (Nest escribe ambos).
  if (log.eventsReceived != null && log.eventsReceived >= 1) return true
  if (log.fbtraceId) return true
  return false
}

/**
 * Clasifica el estado visible del panel a partir de outbox + bitácora + Nest.
 * Prioridad: evidencia Graph > Nest sent > Nest recibido > blocked/pending > unknown.
 */
export function classifyDeliveryOutcome(input: {
  outboxStatus: string
  lastError: string | null
  conversion: ConversionLogEvidence | null
  nest: NestEventLookupEvidence | null
  eventName?: string | null
}): DeliveryOutcomeResult {
  const status = String(input.outboxStatus || '')
  const err = String(input.lastError || '')
  const conv = input.conversion
  const nest = input.nest
  const eventName = String(input.eventName || '')

  if (status === 'pending' && err === 'idempotency_key_conflict') {
    return {
      outcome: 'blocked',
      label: 'Conflicto de idempotencia',
      reason: err,
      graphEvidence: null,
      receptionLabel: 'La clave ya existe con otro ID, fecha, carril, evento o dataset; se conserva sin regenerarla',
    }
  }

  // Captura preparada Purchase / wishlist histórico retenido: no es conversión enviada.
  if (
    err === 'nest_backend_pending' ||
    (eventName === 'Purchase' &&
      (status === 'review_hold' || status === 'needs_review')) ||
    (eventName === 'AddToWishlist' &&
      (status === 'review_hold' || status === 'needs_review'))
  ) {
    return {
      outcome: 'pending_backend_support',
      label:
        eventName === 'AddToWishlist' && status === 'review_hold'
          ? 'Favorito retenido (histórico)'
          : 'Pendiente de soporte backend',
      reason: err || 'nest_backend_pending',
      graphEvidence: null,
      receptionLabel:
        eventName === 'AddToWishlist'
          ? 'Histórico review_hold; no se libera en masa'
          : 'Captura interna; envío Purchase desactivado',
    }
  }

  if (conv?.stage === 'internal_activity') {
    return {
      outcome: 'internal_activity',
      label: 'Actividad interna',
      reason: conv.reason,
      graphEvidence: null,
      receptionLabel: 'Solo CRM; no es conversión Meta',
    }
  }

  if (hasMetaAcceptedEvidence(conv)) {
    return {
      outcome: 'meta_accepted',
      label: 'Aceptado por Meta',
      reason: null,
      graphEvidence: {
        fbtraceId: conv!.fbtraceId,
        eventsReceived: conv!.eventsReceived,
        httpStatus: conv!.httpStatus,
        source: 'conversion_log',
      },
      receptionLabel: `Meta Graph aceptó (events_received=${conv!.eventsReceived ?? 'n/d'}; fbtrace=${conv!.fbtraceId ? 'sí' : 'n/d'})`,
    }
  }

  if (nest?.lookupOk && nest.found && nest.apiAccepted) {
    return {
      outcome: 'meta_accepted',
      label: 'Aceptado por Meta',
      reason: null,
      graphEvidence: {
        fbtraceId: nest.fbtraceId,
        eventsReceived: nest.eventsReceived,
        httpStatus: nest.httpStatus,
        source: 'nest_lookup',
      },
      receptionLabel: `Meta Graph aceptó vía Nest (status=${nest.status})`,
    }
  }

  if (conv?.stage === 'meta_rejected') {
    return {
      outcome: 'meta_rejected',
      label: 'Rechazado por Meta',
      reason: conv.reason || 'meta_rejected',
      graphEvidence: null,
      receptionLabel: `Meta respondió con rechazo (${conv.reason || 'meta_rejected'})`,
    }
  }

  if (nest?.lookupOk && nest.found && nest.deliveryOutcome === 'cancelled') {
    return { outcome: 'cancelled', label: 'Cancelado', reason: nest.lastError || 'cancelled', graphEvidence: null, receptionLabel: 'Cancelado antes de Meta' }
  }
  if (nest?.lookupOk && nest.found && nest.deliveryOutcome === 'meta_rejected') {
    return { outcome: 'meta_rejected', label: 'Rechazado por Meta', reason: nest.lastError || 'meta_rejected', graphEvidence: null, receptionLabel: 'Meta respondió con rechazo' }
  }
  if (nest?.lookupOk && nest.found && nest.deliveryOutcome === 'transport_failed') {
    return { outcome: 'transport_failed', label: 'Fallo de transporte', reason: nest.lastError || 'transport_failed', graphEvidence: null, receptionLabel: 'No hubo respuesta Graph verificable' }
  }
  if (nest?.lookupOk && nest.found && nest.deliveryOutcome === 'meta_unverified') {
    return { outcome: 'meta_unverified', label: 'Respuesta de Meta sin verificar', reason: 'insufficient_evidence', graphEvidence: null, receptionLabel: 'HTTP OK sin events_received verificable' }
  }
  if (nest?.lookupOk && nest.found && nest.deliveryOutcome === 'backend_accepted') {
    return { outcome: 'backend_accepted', label: 'Guardado por el backend', reason: null, graphEvidence: null, receptionLabel: 'Persistido por el backend; todavía no acredita aceptación de Meta' }
  }

  if (conv?.stage === 'transport_failed') {
    return {
      outcome: 'transport_failed',
      label: 'Fallo de transporte',
      reason: conv.reason || 'transport_failed',
      graphEvidence: null,
      receptionLabel: 'El transporte falló; no existe una respuesta comprobada de Meta',
    }
  }

  if (conv?.stage === 'meta_unverified') {
    return {
      outcome: 'meta_unverified',
      label: 'Respuesta de Meta sin verificar',
      reason: conv.reason || 'insufficient_evidence',
      graphEvidence: null,
      receptionLabel: 'Meta respondió HTTP OK sin events_received verificable',
    }
  }

  if (conv?.stage === 'backend_accepted') {
    return {
      outcome: 'backend_accepted',
      label: 'Guardado por el backend',
      reason: conv.reason,
      graphEvidence: null,
      receptionLabel: 'Persistido por el backend; todavía no acredita aceptación de Meta',
    }
  }

  // Nest recibió; Graph aún no verificable — conservar nest_received (no inventar aceptación).
  if (conv?.stage === 'nest_lookup_unverified' && status === 'forwarded') {
    return {
      outcome: 'nest_received',
      label: 'Recibido Nest',
      reason: conv.reason || 'insufficient_evidence',
      graphEvidence: null,
      receptionLabel:
        'Nest recibió el evento; aceptación Graph no verificada (sin reenvío)',
    }
  }

  if (status === 'dead' || (nest?.found && (nest.status === 'dead' || nest.status === 'failed'))) {
    return {
      outcome: 'failed_retrying',
      label: 'Fallido / reintentando',
      reason: nest?.lastError || err || 'dead',
      graphEvidence: null,
      receptionLabel: nest?.lastError || err || 'Fallido en Nest/outbox',
    }
  }

  if (status === 'cancelled' || status === 'needs_review' || status === 'review_hold') {
    if (status === 'cancelled') {
      return { outcome: 'cancelled', label: 'Cancelado', reason: err || 'cancelled', graphEvidence: null, receptionLabel: 'Cancelado antes de Meta' }
    }
    return {
      outcome: 'blocked',
      label: 'Bloqueado',
      reason: status,
      graphEvidence: null,
      receptionLabel: '—',
    }
  }

  if (status === 'pending' && err === 'not_configured') {
    return {
      outcome: 'blocked',
      label: 'Bloqueado',
      reason: 'not_configured',
      graphEvidence: null,
      receptionLabel: '—',
    }
  }

  if (status === 'pending') {
    return {
      outcome: 'pending',
      label: 'Pendiente',
      reason: err || null,
      graphEvidence: null,
      receptionLabel: '—',
    }
  }

  // forwarded en CRM outbox = Nest aceptó el enqueue/drain (evidencia de recepción Nest).
  // Aceptación Graph es capa distinta (meta_accepted arriba).
  if (status === 'forwarded') {
    if (nest?.found && nest.status === 'sent' && !nest.apiAccepted) {
      return {
        outcome: 'unknown',
        label: 'Resultado desconocido',
        reason: nest.acceptanceTier || 'insufficient_evidence',
        graphEvidence: null,
        receptionLabel:
          'Nest marca sent sin evidencia Graph suficiente (no se marca aceptado)',
      }
    }
    return {
      outcome: 'nest_received',
      label: 'Recibido por Nest',
      reason: null,
      graphEvidence: null,
      receptionLabel:
        'Entregado al backend Nest (no implica aceptación Meta Graph)',
    }
  }

  return {
    outcome: 'pending',
    label: status || 'Pendiente',
    reason: err || null,
    graphEvidence: null,
    receptionLabel: '—',
  }
}

/** Compat: mapea outbox status crudo → bucket legacy cuando no hay evidencia. */
export function classifyOutboxStatus(
  status: string,
  lastError: string | null,
): { label: string; bucket: Exclude<MetaCapiStatusBucket, 'all'> } {
  const outcome = classifyDeliveryOutcome({
    outboxStatus: status,
    lastError,
    conversion: null,
    nest: null,
  })
  // Mapear a buckets legacy usados en filtros antiguos
  if (outcome.outcome === 'nest_received') {
    return { label: 'Entregado al backend', bucket: 'delivered_backend' }
  }
  if (outcome.outcome === 'meta_accepted') {
    return { label: outcome.label, bucket: 'meta_accepted' }
  }
  if (outcome.outcome === 'blocked') {
    if (String(lastError || '') === 'not_configured') {
      return { label: 'Bloqueado: sin config CAPI', bucket: 'blocked_config' }
    }
    if (status === 'cancelled') return { label: 'Cancelado', bucket: 'cancelled' }
    if (status === 'needs_review' || status === 'review_hold') {
      return {
        label: status === 'review_hold' ? 'Retenido (revisión)' : 'Retenido',
        bucket: 'retained',
      }
    }
    return { label: outcome.label, bucket: 'blocked' }
  }
  if (outcome.outcome === 'failed_retrying') {
    return { label: 'Fallido', bucket: 'failed' }
  }
  if (outcome.outcome === 'unknown') {
    return { label: outcome.label, bucket: 'unknown' }
  }
  if (outcome.outcome === 'pending_backend_support') {
    return { label: outcome.label, bucket: 'retained' }
  }
  if (outcome.outcome === 'internal_activity') {
    return { label: outcome.label, bucket: 'retained' }
  }
  return { label: 'Pendiente', bucket: 'pending' }
}

export function deliveryOutcomeMatchesFilter(
  outcome: MetaCapiDeliveryOutcome,
  filter: MetaCapiStatusBucket | undefined | null,
): boolean {
  if (!filter || filter === 'all') return true
  if (filter === outcome) return true
  // Compat filtros legacy
  if (filter === 'delivered_backend' && outcome === 'nest_received') return true
  if (filter === 'blocked_config' && outcome === 'blocked') return true
  if (filter === 'failed' && outcome === 'failed_retrying') return true
  if (
    (filter === 'retained' || filter === 'cancelled') &&
    (outcome === 'blocked' ||
      outcome === 'pending_backend_support' ||
      outcome === 'internal_activity')
  ) {
    return true
  }
  return false
}
