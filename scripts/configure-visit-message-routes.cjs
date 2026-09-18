// Run after deployment. Reversible routing update; does not send any message.
require('@next/env').loadEnvConfig(process.cwd())
const { createClient } = require('@supabase/supabase-js')
const fs = require('node:fs')
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const project = 'b1b2c3d4-0001-4000-8000-000000000001', tenant = 'a1b2c3d4-0001-4000-8000-000000000001'
const kinds = ['visit_propose', 'visit_confirm', 'visit_reschedule_confirm', 'visit_2h']
const reminderBody = 'Hola, [Saludo La Vilet]. Es un gusto saludarle. Le recordamos que tiene una cita agendada en La Vilet [Detalle de cita La Vilet].\n\nLe compartimos nuestra ubicación para facilitar su llegada: [Ubicación La Vilet]\n\nSi tiene alguna consulta o necesita cambiar el horario, escríbanos por aquí. ¡Le esperamos!'
async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--apply')) throw Error('Use --apply or no arguments')
  const owner = await db.from('projects').select('id').eq('id', project).eq('tenant_id', tenant).single()
  if (owner.error) throw Error('Project scope could not be verified')
  const read = () => db.from('lv_routes').select('*').eq('project_id', project).in('kind', kinds)
  const { data, error } = await read()
  if (error || data.length !== 4 || data.some(r => ![15578, 18724, 18730, 18350, 22246].includes(r.bot_id) || ![457014, 519824, 513120, 531120].includes(r.detail_field_id))) throw Error('Unexpected routing configuration; inspect before changing')
  const reminder = data.find(r => r.kind === 'visit_2h')
  const conversations = data.filter(r => r.kind !== 'visit_2h')
  if (conversations.every(r => r.bot_id === 15578 && r.detail_field_id === 457014 && r.body_template === '{{detalle}}')
    && reminder?.bot_id === 22246 && reminder?.detail_field_id === 531120 && reminder?.body_template === reminderBody) {
    console.log('Visit routes already use the contextual Salesbot and the dedicated two-hour reminder.'); return
  }
  console.log('Conversation visit routes use 15578/457014; visit_2h uses Salesbot 22246 and field 531120.')
  if (!process.argv.includes('--apply')) return
  fs.mkdirSync('tmp', { recursive: true })
  fs.writeFileSync(`tmp/visit-routes-backup-${Date.now()}.json`, JSON.stringify(data, null, 2))
  const result = await db.from('lv_routes').update({ bot_id: 15578, detail_field_id: 457014, body_template: '{{detalle}}' })
    .eq('project_id', project).in('kind', kinds.filter(kind => kind !== 'visit_2h')).in('bot_id', [15578, 18724, 18730]).select('kind')
  if (result.error || result.data.length !== 3) throw Error('Conversation route update was not verified')
  const reminderResult = await db.from('lv_routes').update({ bot_id: 22246, detail_field_id: 531120, body_template: reminderBody, approved: true })
    .eq('project_id', project).eq('kind', 'visit_2h').in('bot_id', [15578, 18350, 22246]).select('kind')
  if (reminderResult.error || reminderResult.data.length !== 1) throw Error('Reminder route update was not verified')
  const check = await read()
  if (check.error || check.data.some(r => r.kind === 'visit_2h'
    ? r.bot_id !== 22246 || r.detail_field_id !== 531120 || r.body_template !== reminderBody || r.approved !== true
    : r.bot_id !== 15578 || r.detail_field_id !== 457014 || r.body_template !== '{{detalle}}')) throw Error('Route verification failed')
  console.log('Verified three conversation routes and the approved dedicated reminder route; enabled flags preserved. No messages sent.')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
