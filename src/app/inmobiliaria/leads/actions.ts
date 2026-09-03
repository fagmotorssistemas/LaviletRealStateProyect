'use server'

import { assertLoggedIn, getCrmDataClient } from '@/lib/auth/session'
import { listTeamProfiles } from '@/services/inmobiliaria.service'
import type { TeamProfile } from '@/types/inmobiliaria'

/** Lista asesores del CRM. Prefiere service role; si falta, usa la sesión. */
export async function listTeamProfilesAction(): Promise<TeamProfile[]> {
  await assertLoggedIn()
  return listTeamProfiles(await getCrmDataClient())
}
