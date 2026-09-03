'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createLead } from '@/services/inmobiliaria.service'
import {
  interestLabel,
  isValidEmail,
  normalizeEmail,
  normalizePhone,
} from '@/lib/marketing/visitanteIdentity'

export type TourAccessPayload = {
  mode: 'first' | 'returning'
  name?: string
  email?: string
  phone: string
  interest?: string
  message?: string
}

export type TourAccessResult =
  | { ok: true; email: string; password: string }
  | { ok: false; error: string }

type ProfileRow = {
  id: string
  email: string | null
  phone: string | null
  full_name: string | null
}

function oneTimePassword() {
  return `Lv${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}Aa1!`
}

async function findProfileByEmail(admin: ReturnType<typeof createAdminClient>, email: string) {
  const { data } = await admin.from('profiles').select('id, email, phone, full_name').ilike('email', email).limit(5)
  return ((data ?? []) as ProfileRow[]).find((row) => normalizeEmail(row.email ?? '') === email) ?? null
}

async function findProfileByPhone(admin: ReturnType<typeof createAdminClient>, phone: string) {
  const { data } = await admin.from('profiles').select('id, email, phone, full_name').eq('phone', phone).limit(5)
  const exact = ((data ?? []) as ProfileRow[])[0]
  if (exact) return exact

  const { data: listed } = await admin.from('profiles').select('id, email, phone, full_name').not('phone', 'is', null).limit(200)
  return ((listed ?? []) as ProfileRow[]).find((row) => normalizePhone(row.phone ?? '') === phone) ?? null
}

async function signInEmailFor(admin: ReturnType<typeof createAdminClient>, profile: ProfileRow) {
  const fromProfile = normalizeEmail(profile.email ?? '')
  if (fromProfile) return fromProfile
  const { data } = await admin.auth.admin.getUserById(profile.id)
  return normalizeEmail(data.user?.email ?? '')
}

export async function startTourAccessAction(payload: TourAccessPayload): Promise<TourAccessResult> {
  const mode = payload.mode === 'returning' ? 'returning' : 'first'
  const email = normalizeEmail(payload.email ?? '')
  const phone = normalizePhone(payload.phone)
  const name = String(payload.name ?? '').trim()
  const interest = String(payload.interest ?? '').trim()
  const message = String(payload.message ?? '').trim()

  if (phone.length < 7) {
    return { ok: false, error: 'Ingresa un celular válido' }
  }

  const admin = createAdminClient()
  const byPhone = await findProfileByPhone(admin, phone)
  const password = oneTimePassword()

  if (mode === 'returning') {
    if (!byPhone) {
      return {
        ok: false,
        error: 'No encontramos una visita con ese celular. Completa el formulario por primera vez.',
      }
    }

    const signInEmail = await signInEmailFor(admin, byPhone)
    if (!signInEmail) {
      return { ok: false, error: 'No pudimos recuperar esa visita. Completa el formulario por primera vez.' }
    }

    const { error } = await admin.auth.admin.updateUserById(byPhone.id, {
      password,
      email_confirm: true,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true, email: signInEmail, password }
  }

  if (!isValidEmail(email)) {
    return { ok: false, error: 'Ingresa un correo y un celular válidos' }
  }
  if (!name || !interest) {
    return { ok: false, error: 'Completa nombre, correo, celular y qué buscas' }
  }

  const byEmail = await findProfileByEmail(admin, email)

  if (byEmail || byPhone) {
    const samePerson = byEmail && byPhone && byEmail.id === byPhone.id
    if (!samePerson) {
      return {
        ok: false,
        error: 'Ese correo o celular ya tiene una visita. Entra solo con tu celular para seguir el showroom.',
      }
    }
    const { error } = await admin.auth.admin.updateUserById(byEmail.id, {
      password,
      email_confirm: true,
      user_metadata: { full_name: name || byEmail.full_name, phone, interest, role: 'visitante' },
    })
    if (error) return { ok: false, error: error.message }
    await admin
      .from('profiles')
      .update({ full_name: name || byEmail.full_name, phone, email })
      .eq('id', byEmail.id)
    return { ok: true, email, password }
  }

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name, phone, interest, role: 'visitante' },
  })

  let userId = created.data.user?.id
  if (created.error || !userId) {
    const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const match = listed.users.find((item) => normalizeEmail(item.email ?? '') === email)
    if (!match) {
      return { ok: false, error: created.error?.message ?? 'No se pudo crear la visita' }
    }
    userId = match.id
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      user_metadata: { full_name: name, phone, interest, role: 'visitante' },
    })
    if (error) return { ok: false, error: error.message }
  }

  await admin.from('profiles').upsert(
    {
      id: userId,
      email,
      full_name: name,
      phone,
      role: 'visitante',
      is_active: true,
    },
    { onConflict: 'id' },
  )

  const notes = [`Interés: ${interestLabel(interest)}`, message ? `Mensaje: ${message}` : null]
    .filter(Boolean)
    .join('\n')

  try {
    const { data: tenant } = await admin.from('tenants').select('id').limit(1).maybeSingle()
    if (tenant?.id) {
      const { data: existingLeads } = await admin.from('leads').select('id').eq('phone', phone).limit(1)
      const existingLead = existingLeads?.[0]
      if (existingLead?.id) {
        await admin
          .from('leads')
          .update({ name, resume: notes, source: 'web_360' })
          .eq('id', existingLead.id)
      } else {
        await createLead(admin, {
          tenant_id: tenant.id,
          name,
          phone,
          status: 'nuevo',
          temperature: 'frio',
          source: 'web_360',
          resume: notes,
        })
      }
    }
  } catch (error) {
    console.error('No se pudo guardar el lead del tour', error)
  }

  return { ok: true, email, password }
}
