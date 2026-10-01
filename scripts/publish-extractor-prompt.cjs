/* eslint-disable @typescript-eslint/no-require-imports */
// Default: inspect only. --apply publishes with optimistic concurrency;
// the previous prompt is saved locally before the write. No model/CRM calls.
const fs = require('node:fs'), path = require('node:path')
const root = path.resolve(__dirname, '..')
require('@next/env').loadEnvConfig(root, true, { info() {}, error() {} })
const { createClient } = require('@supabase/supabase-js')
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const tenant = 'a1b2c3d4-0001-4000-8000-000000000001', project = 'b1b2c3d4-0001-4000-8000-000000000001'
async function main() {
  const content = fs.readFileSync(path.join(root, 'supabase/prompts/extractor-eventos.md'), 'utf8').trim()
  const { data: rows, error } = await client.from('agent_prompts').select('id,name,content,version,updated_at')
    .eq('tenant_id', tenant).eq('project_id', project).eq('name', 'extractor_eventos').eq('is_active', true).limit(2).abortSignal(AbortSignal.timeout(10000))
  if (error || rows?.length !== 1) throw Error('PROMPT_NOT_UNIQUE_OR_UNAVAILABLE')
  const previous = rows[0]
  if (previous.content.trim() === content) { console.log(JSON.stringify({ status: 'already_current', version: previous.version })); return }
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ status: 'ready', version: previous.version, current_characters: previous.content.length, proposed_characters: content.length })); return
  }
  const backup = path.join(root, `supabase/operations/extractor-eventos-before-v${previous.version + 1}.json`)
  fs.writeFileSync(backup, JSON.stringify(previous, null, 2) + '\n', { flag: 'wx' })
  const { data: updated, error: writeError } = await client.from('agent_prompts')
    .update({ content, version: previous.version + 1, updated_at: new Date().toISOString() })
    .eq('id', previous.id).eq('tenant_id', tenant).eq('project_id', project)
    .eq('version', previous.version).eq('content', previous.content).eq('is_active', true).select('id,version,content').maybeSingle()
  if (writeError || !updated) throw Error('PROMPT_CHANGED_OR_UPDATE_FAILED')
  const { data: verified, error: readError } = await client.from('agent_prompts').select('content,version').eq('id', previous.id).single()
  if (readError || verified.content !== content || verified.version !== updated.version) throw Error('PROMPT_READBACK_FAILED')
  console.log(JSON.stringify({ status: 'published_and_verified', version: updated.version, backup: path.relative(root, backup) }))
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
