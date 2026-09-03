'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/types/inmobiliaria'

export type SessionProfileRow = {
  id: string
  full_name: string | null
  avatar_url: string | null
  role: UserRole | null
  phone: string | null
  email: string | null
}

export async function getMyProfileAction(): Promise<SessionProfileRow | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await createAdminClient()
    .from('profiles')
    .select('id, full_name, avatar_url, role, phone, email')
    .eq('id', user.id)
    .maybeSingle()

  if (error) {
    console.error('getMyProfileAction', error.message)
    return null
  }
  return (data as SessionProfileRow | null) ?? null
}
