'use server'

import { assertCanAccessCrmPath } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { readMessageEvidence } from '@/services/marketingEvidence.service'

/** Authorize the exact CRM row with the caller's RLS before using server-only evidence. */
export async function listLeadMessageEvidence(leadId:string,tenantId:string) {
  await assertCanAccessCrmPath('/inmobiliaria/leads')
  const client=await createClient()
  const {data:lead,error}=await client.from('leads').select('id,tenant_id,project_id').eq('id',leadId).eq('tenant_id',tenantId).maybeSingle()
  if(error || !lead) throw Error('Contacto fuera de alcance')
  if(lead.project_id){
    const {data:project,error:projectError}=await client.from('projects').select('id').eq('id',lead.project_id).eq('tenant_id',tenantId).maybeSingle()
    if(projectError || !project) throw Error('Proyecto fuera de alcance')
  }
  const admin=tryCreateAdminClient()
  if(!admin) return {available:false,rows:[]}
  return readMessageEvidence(admin,tenantId,[leadId],new Date().toISOString())
}
