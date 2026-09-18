export type MetaCapiStatusBucket =
  | 'all'
  | 'delivered_backend'
  | 'pending'
  | 'blocked_config'
  | 'retained'
  | 'cancelled'
  | 'failed'

export function classifyOutboxStatus(
  status: string,
  lastError: string | null,
): { label: string; bucket: Exclude<MetaCapiStatusBucket, 'all'> } {
  const err = String(lastError || '')
  if (status === 'forwarded') {
    return { label: 'Entregado al backend', bucket: 'delivered_backend' }
  }
  if (status === 'dead') return { label: 'Fallido', bucket: 'failed' }
  if (status === 'cancelled') return { label: 'Cancelado', bucket: 'cancelled' }
  if (status === 'needs_review' || status === 'review_hold') {
    return { label: status === 'review_hold' ? 'Retenido (revisión)' : 'Retenido', bucket: 'retained' }
  }
  if (status === 'pending' && err === 'not_configured') {
    return { label: 'Bloqueado: sin config CAPI', bucket: 'blocked_config' }
  }
  if (status === 'pending') return { label: 'Pendiente', bucket: 'pending' }
  return { label: status, bucket: 'pending' }
}
