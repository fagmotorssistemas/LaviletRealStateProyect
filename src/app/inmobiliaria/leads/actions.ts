'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { listTeamProfiles } from '@/services/inmobiliaria.service'
import type { TeamProfile } from '@/types/inmobiliaria'

async function assertLoggedIn() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')
}

/** Lista asesores del CRM. Usa service role porque RLS de `profiles` no deja ver al equipo. */
export async function listTeamProfilesAction(): Promise<TeamProfile[]> {
  await assertLoggedIn()
  return listTeamProfiles(createAdminClient())
}
