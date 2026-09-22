/**
 * Lógica pura del embudo (testeable sin I/O).
 */

export type TemperatureBucket = 'frio' | 'tibio' | 'caliente' | 'sin_clasificar'

export function emptyTemp(): Record<TemperatureBucket, number> {
  return { frio: 0, tibio: 0, caliente: 0, sin_clasificar: 0 }
}

export function bucketTemp(raw: string | null | undefined): TemperatureBucket {
  const t = String(raw || '').trim().toLowerCase()
  if (t === 'frio' || t === 'tibio' || t === 'caliente') return t
  return 'sin_clasificar'
}

export function isDateYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function ecuadorDayBoundsUtc(fromYmd: string, toYmd: string): {
  fromIso: string
  toExclusiveIso: string
} {
  if (!isDateYmd(fromYmd) || !isDateYmd(toYmd)) {
    throw new Error('period_from_to_must_be_YYYY-MM-DD')
  }
  const fromIso = `${fromYmd}T05:00:00.000Z`
  const toDate = new Date(`${toYmd}T05:00:00.000Z`)
  toDate.setUTCDate(toDate.getUTCDate() + 1)
  return { fromIso, toExclusiveIso: toDate.toISOString() }
}

/** Suma importes conocidos; null si ninguno tiene valor (no fingir 0). */
export function sumKnownAmounts(
  values: Array<number | null | undefined>,
): number | null {
  let sum = 0
  let any = false
  for (const v of values) {
    if (v == null || Number.isNaN(Number(v))) continue
    sum += Number(v)
    any = true
  }
  return any ? sum : null
}

export type ApptPeriodClass =
  | 'scheduled'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'other'

/**
 * Clasifica una cita cuyo start_time cae en el período de informe.
 * No presenta cancelada/futura como realizada.
 */
export function classifyAppointmentInPeriod(
  appt: {
    status: string | null
    no_show: boolean | null
    start_time: string | null
  },
  nowIso: string,
): ApptPeriodClass {
  const status = String(appt.status || '').toLowerCase()
  if (status === 'cancelado') return 'cancelled'
  if (status === 'atendido' && appt.no_show === true) return 'no_show'
  if (status === 'atendido' && appt.no_show !== true) return 'completed'
  const start = appt.start_time
  if (!start) return 'other'
  // Futura o aún no atendida (solicitada/pendiente/aceptado/reprogramado)
  if (start > nowIso) return 'scheduled'
  if (
    status === 'solicitada' ||
    status === 'pendiente' ||
    status === 'aceptado' ||
    status === 'reprogramado' ||
    status === ''
  ) {
    // Pasada en calendario pero no marcada atendida → programada pendiente de cierre
    return 'scheduled'
  }
  return 'other'
}

/**
 * Unidades de cita: solo appointment_units.
 * Vacío → unidad no determinada.
 */
export function resolveAppointmentUnitIds(
  appointmentId: string,
  links: Array<{ appointment_id: string; unit_id: string }>,
): { unitIds: string[]; undetermined: boolean } {
  const unitIds = [
    ...new Set(
      links
        .filter((l) => l.appointment_id === appointmentId)
        .map((l) => l.unit_id),
    ),
  ]
  return { unitIds, undetermined: unitIds.length === 0 }
}

/**
 * Reserva de un lead: solo unidades con status reservado vinculadas al lead.
 * Si el lead está reservado pero ninguna unidad califica → undetermined (unidad).
 * No atribuye la reserva a todos los interesados de la unidad.
 */
export function resolveReservedUnitIds(input: {
  leadId: string
  leadStatus: string | null
  leadUnitIds: string[]
  unitStatusById: Map<string, string | null>
}): { unitIds: string[]; undetermined: boolean } {
  if (String(input.leadStatus || '').toLowerCase() !== 'reservado') {
    return { unitIds: [], undetermined: false }
  }
  const unitIds = input.leadUnitIds.filter(
    (uid) =>
      String(input.unitStatusById.get(uid) || '').toLowerCase() === 'reservado',
  )
  if (unitIds.length === 0) {
    return { unitIds: [], undetermined: true }
  }
  return { unitIds, undetermined: false }
}

/**
 * Titular comprobado de una unidad en status=reservado.
 * Exactamente 1 lead con status=reservado vinculado → titular.
 * 0 o >1 → titular no determinado (no atribuir a interesados).
 */
export function resolveReservationTitular(input: {
  unitId: string
  unitStatus: string | null
  candidates: Array<{
    leadId: string
    leadStatus: string | null
    linkedUnitIds: string[]
  }>
}): { titularLeadId: string | null; undeterminedTitular: boolean } {
  if (String(input.unitStatus || '').toLowerCase() !== 'reservado') {
    return { titularLeadId: null, undeterminedTitular: false }
  }
  const titulares = input.candidates.filter(
    (c) =>
      String(c.leadStatus || '').toLowerCase() === 'reservado' &&
      c.linkedUnitIds.includes(input.unitId),
  )
  if (titulares.length === 1) {
    return { titularLeadId: titulares[0].leadId, undeterminedTitular: false }
  }
  return { titularLeadId: null, undeterminedTitular: true }
}

export type ContractAnulSnapshot = {
  id: string
  status: 'anulado'
  /** Sin columna de anulación → siempre desconocida */
  annulledAt: null
  signedAt: string | null
  createdAt: string
}

export function snapshotAnulledContracts(
  rows: Array<{
    id: string
    status: string | null
    signed_at: string | null
    created_at: string
  }>,
): ContractAnulSnapshot[] {
  return rows
    .filter((r) => String(r.status || '').toLowerCase() === 'anulado')
    .map((r) => ({
      id: r.id,
      status: 'anulado' as const,
      annulledAt: null,
      signedAt: r.signed_at,
      createdAt: r.created_at,
    }))
}

/** Universos temporales del informe (explícitos). */
export const FUNNEL_UNIVERSES = {
  cohortLeads: 'leads.created_at ∈ período Ecuador (tenant+project)',
  attributedAdAppointments:
    'todas las citas de leads de la cohorte (sin filtro temporal de cita)',
  attributedAdSales:
    'unit_sales_closings.sale_at ∈ período ∧ lead ∈ cohorte del anuncio ∧ unidad del project',
  periodAppointmentsByStart:
    'appointments.start_time ∈ período; clasificadas scheduled|completed|cancelled|no_show',
  periodSales: 'unit_sales_closings.sale_at ∈ período ∧ unidad del project',
  periodShowroom: 'showroom_visits.visit_start ∈ período ∧ project_id',
  contractsAnulledSnapshot:
    'contracts.status=anulado actuales del project (vía lead/unidades); annulledAt desconocida',
} as const
