// After the SQL test reset, also release Kommo's independent DETENER IA switch.
// Preview by default. Never sends a message or replays a received webhook.
require('@next/env').loadEnvConfig(process.cwd())
const fs = require('node:fs')
const path = require('node:path')
const { createClient } = require('@supabase/supabase-js')

const TEST_LEAD = '52fa6e93-4bd4-42ad-963a-666e9c7902a7'
const PROJECT = 'b1b2c3d4-0001-4000-8000-000000000001'
const TENANT = 'a1b2c3d4-0001-4000-8000-000000000001'
const KOMMO_LEAD = 2710090
const CONTACT = 6431312
const STOP_FIELD = 451530
const ORIGIN = 'https://lavilet.kommo.com'

async function kommo(route, method = 'GET', body) {
  if (!process.env.KOMMO_ACCESS_TOKEN) throw Error('KOMMO_CREDENTIALS_MISSING')
  const response = await fetch(ORIGIN + route, {
    method, headers: { Authorization: `Bearer ${process.env.KOMMO_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw Error(`KOMMO_${response.status}`)
  return response.json()
}
const stopValue = lead => lead.custom_fields_values?.find(field => field.field_id === STOP_FIELD)?.values?.[0]?.value
const stopped = value => [true, 1, 'true', '1'].includes(value)

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { data: lead, error } = await db.from('leads')
    .select('id,tenant_id,project_id,kommo_id,phone,bot_enabled,handoff_status,tracking_opt_out_at')
    .eq('id', TEST_LEAD).single().abortSignal(AbortSignal.timeout(15000))
  if (error || !lead || lead.tenant_id !== TENANT || lead.project_id !== PROJECT || lead.kommo_id !== KOMMO_LEAD
    || lead.phone?.replace(/\D/g, '') !== '593987110032') throw Error('TEST_LEAD_MISMATCH')
  if (lead.bot_enabled !== true || lead.handoff_status !== 'none' || lead.tracking_opt_out_at) {
    throw Error('RESET_REQUIRED: primero ejecute el reinicio del lead de prueba en Supabase')
  }
  const remote = await kommo(`/api/v4/leads/${KOMMO_LEAD}?with=contacts`)
  if (remote.id !== KOMMO_LEAD || !remote._embedded?.contacts?.some(contact => contact.id === CONTACT)) throw Error('KOMMO_CONTACT_MISMATCH')
  const value = stopValue(remote)
  if (!stopped(value)) return console.log('El lead de prueba ya está habilitado en Supabase y Kommo.')
  if (!process.argv.includes('--apply')) {
    return console.log('Vista previa: se cambiará DETENER IA de true a false únicamente en el lead de prueba Kommo 2710090. Use --apply para continuar.')
  }
  const backup = path.join('tmp', `resume-test-lead-${Date.now()}.json`)
  fs.mkdirSync('tmp', { recursive: true })
  fs.writeFileSync(backup, JSON.stringify({ lead_id: TEST_LEAD, kommo_id: KOMMO_LEAD, field_id: STOP_FIELD, previous_value: value, at: new Date().toISOString() }, null, 2))
  // PATCH only this switch, never replace the rest of the lead's fields.
  await kommo(`/api/v4/leads/${KOMMO_LEAD}`, 'PATCH', { custom_fields_values: [{ field_id: STOP_FIELD, values: [{ value: 'false' }] }] })
  const verified = await kommo(`/api/v4/leads/${KOMMO_LEAD}`)
  if (stopped(stopValue(verified))) throw Error('KOMMO_STILL_PAUSED')
  console.log(`Verificado: IA habilitada para el lead de prueba. Respaldo: ${backup}`)
  console.log('Los mensajes descartados mientras la IA estaba detenida no se reenvían. Envíe un nuevo saludo para comenzar.')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
