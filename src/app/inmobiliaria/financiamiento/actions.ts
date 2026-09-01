'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  createAsesoriaFinanciamiento,
  createLeadFinancing,
  findOrCreateFinancingPartner,
  listAsesoriasFinanciamiento,
  listFinancingPartners,
  listLeadFinancing,
} from '@/services/inmobiliaria.service'
import type { AsesoriaFinanciamiento, FinancingPartner, LeadFinancing } from '@/types/inmobiliaria'

async function assertLoggedIn() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')
}

export async function listLeadFinancingAction(params: {
  status?: string
  search?: string
} = {}): Promise<LeadFinancing[]> {
  await assertLoggedIn()
  return listLeadFinancing(createAdminClient(), params)
}

export async function listAsesoriasFinanciamientoAction(params: {
  search?: string
  atendido?: boolean
} = {}): Promise<AsesoriaFinanciamiento[]> {
  await assertLoggedIn()
  return listAsesoriasFinanciamiento(createAdminClient(), params)
}

export async function listFinancingPartnersAction(): Promise<FinancingPartner[]> {
  await assertLoggedIn()
  return listFinancingPartners(createAdminClient())
}

export async function createLeadFinancingAction(
  payload: Parameters<typeof createLeadFinancing>[1] & { financing_partner_name?: string | null },
): Promise<LeadFinancing> {
  await assertLoggedIn()
  const admin = createAdminClient()
  const { financing_partner_name, ...rest } = payload
  let partnerId = rest.financing_partner_id || null
  if (!partnerId && financing_partner_name?.trim()) {
    const partner = await findOrCreateFinancingPartner(admin, {
      name: financing_partner_name,
      partner_type: rest.financing_type,
    })
    partnerId = partner.id
  }
  return createLeadFinancing(admin, { ...rest, financing_partner_id: partnerId })
}

export async function createAsesoriaFinanciamientoAction(
  payload: Parameters<typeof createAsesoriaFinanciamiento>[1],
): Promise<AsesoriaFinanciamiento> {
  await assertLoggedIn()
  return createAsesoriaFinanciamiento(createAdminClient(), payload)
}
