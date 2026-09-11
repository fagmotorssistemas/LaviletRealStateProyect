// Preview by default. --apply updates these four prompts with optimistic concurrency.
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process')
require('@next/env').loadEnvConfig(process.cwd())
const { createClient } = require('@supabase/supabase-js')
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const names = ['saludo_inicial', 'respuesta_comercial', 'revisor_respuesta', 'extractor_eventos']
const normalize = value => value.replace(/\r\n/g, '\n').trim()
const marker = '\n\nREGLAS DE CONTINUIDAD · 2026-09-10\n'
async function main() {
  const result = await db.from('agent_prompts').select('*').eq('tenant_id', 'a1b2c3d4-0001-4000-8000-000000000001')
    .eq('project_id', 'b1b2c3d4-0001-4000-8000-000000000001').eq('is_active', true).in('name', names)
  if (result.error) throw new Error(result.error.message)
  const changes = result.data.map(row => {
    const file = 'docs/prompts/'+row.name+'.md'
    const current = normalize(fs.readFileSync(file, 'utf8'))
    const previous = normalize(execFileSync('git', ['show', 'HEAD:'+file], { encoding: 'utf8' }))
    let content
    if (normalize(row.content) === current) content = row.content
    else if (normalize(row.content) === previous || row.name === 'saludo_inicial') content = current
    else {
      // Preserve any custom sales script edited through the interface.
      const addition = row.name === 'respuesta_comercial' ? current.slice(current.indexOf('CONTINUIDAD Y AYUDA PRÁCTICA'))
        : row.name === 'revisor_respuesta' ? current.slice(current.indexOf('Rechace proponer'))
          : current.slice(current.indexOf('- Si pide visita pero no indica horario'))
      content = row.content.split(marker)[0].replace('ni que el saludo aislado carezca de una pregunta comercial', 'el saludo aislado solo requiere ofrecer ayuda') + marker + addition
    }
    return { before: row, content }
  })
  if (changes.length !== names.length) throw new Error('Faltan prompts activos; no se aplicaron cambios')
  const apply = process.argv.includes('--apply')
  if (apply) {
    const folder = path.join('tmp','conversation-prompts-'+new Date().toISOString().replace(/[:.]/g,'-'))
    fs.mkdirSync(folder,{recursive:true})
    fs.writeFileSync(path.join(folder,'before.json'),JSON.stringify(changes.map(c=>c.before),null,2))
    console.log('Backup:',folder)
  }
  for (const {before,content} of changes) {
    if (normalize(before.content) === normalize(content)) { console.log(before.name,'sin cambios'); continue }
    if (apply) {
      const update = await db.from('agent_prompts').update({content,version:before.version+1,updated_at:new Date().toISOString(),updated_by:null})
        .eq('id',before.id).eq('version',before.version).eq('content',before.content).eq('is_active',true).select('id')
      if(update.error || update.data?.length!==1) throw new Error('El prompt cambió o no pudo guardarse: '+before.name)
    }
    console.log(JSON.stringify({name:before.name,from:before.version,to:before.version+1,applied:apply}))
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
