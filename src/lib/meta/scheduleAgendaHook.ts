/**
 * Gancho agenda → Schedule: cuándo notificar tras save de request.
 * Sin I/O Meta; inyectable para pruebas.
 */
export async function notifyScheduleIfRequestConfirmed<TSupabase>(
  supabase: TSupabase,
  request: { status?: string | null; appointment_id?: string | null } | null | undefined,
  notify: (supabase: TSupabase, appointmentId: string) => Promise<unknown>,
): Promise<boolean> {
  if (!request || request.status !== 'confirmed') return false
  const appointmentId = String(request.appointment_id || '').trim()
  if (!appointmentId) return false
  await notify(supabase, appointmentId)
  return true
}
