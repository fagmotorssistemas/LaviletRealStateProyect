// Scoped, reversible refresh of the two editable commercial prompts.
require('@next/env').loadEnvConfig(process.cwd())
const { createClient } = require('@supabase/supabase-js')
const fs = require('node:fs')
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const scope = { tenant_id: 'a1b2c3d4-0001-4000-8000-000000000001', project_id: 'b1b2c3d4-0001-4000-8000-000000000001' }
async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--apply')) throw Error('Use --apply or no arguments')
  const { data, error } = await db.from('agent_prompts').select('*').match(scope).in('name', ['respuesta_comercial', 'revisor_respuesta']).eq('is_active', true)
  if (error || data?.length !== 2) throw Error('Expected two active prompts; inspect configuration')
  const changes = data.map(row => {
    const questions = row.content.match(/# GUION CRM START[\s\S]*?# GUION CRM END/)?.[0]
    const content = fs.readFileSync(`config/bot/${row.name}.txt`, 'utf8').trim() + (questions ? '\n\n' + questions : '')
    return { row, content }
  }).filter(change => change.content !== change.row.content)
  console.log(JSON.stringify(changes.map(({ row, content }) => ({ name: row.name, version: row.version + 1, characters: content.length }))))
  if (!process.argv.includes('--apply') || !changes.length) return
  fs.mkdirSync('tmp', { recursive: true })
  const backup = `tmp/commercial-prompts-backup-${Date.now()}.json`
  fs.writeFileSync(backup, JSON.stringify(data, null, 2))
  console.log('Backup: ' + backup)
  for (const { row, content } of changes) {
    const result = await db.from('agent_prompts').update({ content, version: row.version + 1, updated_at: new Date().toISOString(), notes: 'Contexto actual, precio por fase, material y traspaso verificado; reglas coherentes 14-09-2026.' })
      .match(scope).eq('id', row.id).eq('version', row.version).select('id,version').single()
    if (result.error) throw Error('Prompt changed concurrently or update failed: ' + row.name)
    const check = await db.from('agent_prompts').select('content,version').match(scope).eq('id', row.id).single()
    if (check.error || check.data.content !== content) throw Error('Prompt verification failed: ' + row.name)
    console.log(row.name + ': verified version ' + check.data.version)
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
