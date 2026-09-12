'use server'

import {
  assertCanAccessCrmPath,
  assertCanWriteCrm,
  getCrmDataClient,
  getSessionProfile,
} from '@/lib/auth/session'
import { TOUR_TENANT_ID } from '@/lib/tour/trackingIds'
import {
  createAsesoriaFinanciamiento,
  createLead,
  createLeadFinancing,
  findOrCreateFinancingPartner,
  listAsesoriasFinanciamiento,
  listFinancingPartners,
  listLeadFinancing,
} from '@/services/inmobiliaria.service'
import type { AsesoriaFinanciamiento, FinancingPartner, Lead, LeadFinancing } from '@/types/inmobiliaria'

export async function listLeadFinancingAction(params: {
  status?: string
  search?: string
} = {}): Promise<LeadFinancing[]> {
  await assertCanAccessCrmPath('/inmobiliaria/financiamiento')
  return listLeadFinancing(await getCrmDataClient(), params)
}

export async function listAsesoriasFinanciamientoAction(params: {
  search?: string
  atendido?: boolean
} = {}): Promise<AsesoriaFinanciamiento[]> {
  await assertCanAccessCrmPath('/inmobiliaria/financiamiento')
  return listAsesoriasFinanciamiento(await getCrmDataClient(), params)
}

export async function listFinancingPartnersAction(): Promise<FinancingPartner[]> {
  await assertCanAccessCrmPath('/inmobiliaria/financiamiento')
  return listFinancingPartners(await getCrmDataClient())
}

export async function createLeadForQuoteAction(payload: {
  name: string
  phone?: string | null
  email?: string | null
  unit_id?: string | null
  source?: string | null
}): Promise<Lead> {
  await assertCanAccessCrmPath('/inmobiliaria/financiamiento')
  await assertCanWriteCrm()
  const admin = await getCrmDataClient()
  const session = await getSessionProfile()
  if (!session) throw new Error('No autenticado')
  const name = payload.name.trim()
  if (!name) throw new Error('El nombre del lead es obligatorio')
  const phone = payload.phone?.trim() || null
  return createLead(
    admin,
    {
      tenant_id: TOUR_TENANT_ID,
      name,
      phone,
      source: payload.source?.trim() || 'financiamiento_crm',
      status: 'nuevo',
      assigned_to: session.user.id,
    },
    payload.unit_id ? [payload.unit_id] : undefined,
  )
}

export async function createLeadFinancingAction(
  payload: Parameters<typeof createLeadFinancing>[1] & { financing_partner_name?: string | null },
): Promise<LeadFinancing> {
  await assertCanAccessCrmPath('/inmobiliaria/financiamiento')
  await assertCanWriteCrm()
  const admin = await getCrmDataClient()
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
  await assertCanAccessCrmPath('/inmobiliaria/financiamiento')
  await assertCanWriteCrm()
  return createAsesoriaFinanciamiento(await getCrmDataClient(), payload)
}
