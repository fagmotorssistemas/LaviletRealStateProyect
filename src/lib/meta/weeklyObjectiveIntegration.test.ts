import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { WEEKLY_OBJECTIVE_DEFINITIONS, WEEKLY_OBJECTIVE_UNMAPPED_RULES } from './weeklyObjectiveDefinitions'

const root=process.cwd()
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260925120000_weekly_objective_qualification_selection.sql'),'utf8')
const linkMigration=fs.readFileSync(path.join(root,'supabase/migrations/20260925123000_link_weekly_selections_to_canonical_qualification.sql'),'utf8')
const service=fs.readFileSync(path.join(root,'src/services/weeklyObjectiveQualification.service.ts'),'utf8')

test('la persistencia no modifica reglas, puntos, temperaturas o umbrales',()=>{
  for(const forbidden of [/update\s+public\.lead_scoring_rules/i,/insert\s+into\s+public\.lead_scoring_rules/i,/project_automation_config/i,/temperature_score\s*=/i])assert.doesNotMatch(migration,forbidden)
  assert.match(migration,/enabled boolean not null default false/i)
})

test('las relaciones se derivan de reglas con significado y deja genéricas pendientes',()=>{
  assert.deepEqual(WEEKLY_OBJECTIVE_UNMAPPED_RULES,['first_response','nutrition_response','decay_7d','decay_14d'])
  const mapped=new Set(WEEKLY_OBJECTIVE_DEFINITIONS.flatMap(row=>[...row.eventTypes]))
  for(const event of ['asked_financing','requested_visit','appointment_confirmed','asked_reservation','asked_price','tour360_iniciado'])assert.equal(mapped.has(event),true)
})

test('persistir selección no crea outbox ni conversiones y la métrica Meta lee aceptación real',()=>{
  assert.doesNotMatch(migration,/(?:insert\s+into|update|delete\s+from)\s+public\.meta_capi_outbox/i)
  assert.doesNotMatch(migration,/(?:insert\s+into|update|delete\s+from)\s+public\.(?:appointments|unit_sales_closings)/i)
  assert.match(service,/meta_capi_conversion_log[\s\S]*meta_accepted/)
  assert.match(service,/eq\('stage','meta_accepted'\)\.eq\('delivery_lane','live'\)/)
  assert.match(service,/eq\('delivery_lane','live'\)/)
  assert.match(service,/status\)==='enqueued'/)
  assert.match(service,/meta_capi_outbox[\s\S]*forwarded_at/)
  assert.doesNotMatch(linkMigration,/(?:insert\s+into|update|delete\s+from)\s+public\.meta_capi_outbox/i)
  assert.match(linkMigration,/qualification_event_id[\s\S]*new\.event_id/i)
  assert.match(linkMigration,/where s\.lead_id = new\.lead_id[\s\S]*qualification_intent_id is null/i)
})
