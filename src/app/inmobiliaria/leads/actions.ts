'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { assertLoggedIn } from '@/lib/auth/session'
import { listTeamProfiles } from '@/services/inmobiliaria.service'
import type { TeamProfile } from '@/types/inmobiliaria'

/** Lista asesores del CRM. Usa service role porque RLS de `profiles` no deja ver al equipo. */
export async function listTeamProfilesAction(): Promise<TeamProfile[]> {
  await assertLoggedIn()
  return listTeamProfiles(createAdminClient())
}
