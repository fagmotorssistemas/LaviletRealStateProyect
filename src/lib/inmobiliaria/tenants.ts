import type { SupabaseClient } from '@supabase/supabase-js'

/** Tenants visibles para la sesión (RLS). El primero se usa al crear registros. */
export async function getAccessibleTenantIds(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from('tenants').select('id')
  if (error) throw error
  return (data ?? []).map((row) => row.id)
}
