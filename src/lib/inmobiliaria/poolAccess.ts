type Row = Record<string, unknown>
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
export type PoolAccessSettings = { allowTemporaryGuests: boolean }
export type PoolAccessResult = { ok: true; state: { settings: PoolAccessSettings; version: string } } | { ok: false; error: string }

/** Residents retain access. This switch concerns guests of temporary rentals,
 * not tenants who live in the building, charges or other facilities. */
export function poolAccessSettings(policies: unknown): PoolAccessSettings {
  return { allowTemporaryGuests: row(row(policies).pool_access).allowTemporaryGuests === true }
}
export function changePoolAccess(policies: unknown, value: unknown, actor: string, at: string): Row {
  const input = row(value)
  if (typeof input.allowTemporaryGuests !== 'boolean') throw Error('Seleccione si los huéspedes de alquiler temporal pueden usar la piscina.')
  return { ...row(policies), pool_access: { allowTemporaryGuests: input.allowTemporaryGuests, updatedAt: at, updatedBy: actor } }
}
export function poolAccessContext(policies: unknown): Row {
  const settings = poolAccessSettings(policies)
  return { ...settings, residents_allowed: true, scope: 'piscina',
    source: 'Condición de acceso aprobada por el responsable del proyecto; editable en Instalaciones y piscina.',
    rule: settings.allowTemporaryGuests
      ? 'Los residentes y los huéspedes de alquiler temporal de las unidades pueden utilizar la piscina.'
      : 'La piscina es de uso exclusivo para residentes. Los huéspedes de alquiler temporal, como Airbnb, no tienen acceso.',
    instruction: 'Esta condición está definida: comuníquela directamente cuando pregunten quién puede usar la piscina. Un inquilino que reside en el edificio es residente; distíngalo de un huésped temporal. Esta regla específica prevalece sobre una descripción antigua de la piscina y no modifica el acceso a otras instalaciones, cobros ni alícuotas. No presente el permiso o la restricción como pendiente de confirmar.' }
}
