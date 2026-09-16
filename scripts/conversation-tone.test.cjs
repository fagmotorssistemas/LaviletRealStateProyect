const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const { createHash } = require('node:crypto')
const root = path.resolve(__dirname, '..')
const originalLoad = Module._load
Module._load = function(id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(root, 'src', id.slice(2))
  return originalLoad.call(this, id, parent, main)
}
require('./test-typescript.cjs')
const hash = value => createHash('sha256').update(value).digest('hex')
const declarations = {
  'conversation-style': ['NATURAL_CONVERSATION_RULES'],
  'commercial-experience': ['COMMERCIAL_EXPERIENCE_RULES'],
  'operational-copy': ['WRITING_RULES', 'REVIEW_RULES'],
  'turn-completeness': ['COVERAGE_RULES', 'REVIEW_RULES'],
  'business-scope': ['BUSINESS_SCOPE_RULES'],
}
function load(name, source, mocks = {}) {
  const file = path.join(root, 'src/lib/integrations/automation', name + '.ts')
  const names = declarations[name] || []
  const code = ts.transpileModule((source || fs.readFileSync(file, 'utf8')) + `\nmodule.exports.__rules = {${names.join(',')}}`, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
  const m = {exports:{}}, local = Module.createRequire(file)
  new Function('require','module','exports',code)(id => id in mocks ? mocks[id] : local(id),m,m.exports)
  return m.exports
}
async function fingerprints(originals = {}) {
  const result = {}
  const source = name => originals['src/lib/integrations/automation/' + name + '.ts']
  for (const name of Object.keys(declarations)) for(const [key,value] of Object.entries(load(name,source(name)).__rules)) result[name+'.'+key] = hash(value)
  const openings = load('response-openings',source('response-openings'))
  for (const [i,history] of [[],[{role:'bot',content:'Con gusto. Tenemos opciones.'}],[{role:'bot',content:'Con gusto. Tenemos opciones.'},{role:'bot',content:'Perfecto. Revisamos su solicitud.'}]].entries()) result['opening.'+i] = hash(openings.openingWritingRules(history))
  let instructions
  const ai = load('ai',source('ai'), {'./openai-request': {requestOpenAI:async (_url,init) => {
    instructions=JSON.parse(init.body).instructions
    return {json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'{"mensaje":"Respuesta de prueba"}'}]}]})}
  }}})
  const key=process.env.OPENAI_API_KEY,model=process.env.OPENAI_MODEL
  try {process.env.OPENAI_API_KEY='test';process.env.OPENAI_MODEL='test';await ai.draftReply('Instrucción base',{});result.draft=hash(instructions)}
  finally {if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;if(model===undefined)delete process.env.OPENAI_MODEL;else process.env.OPENAI_MODEL=model}
  return result
}
if (process.argv.includes('--capture-original')) {
  fingerprints(JSON.parse(fs.readFileSync(path.join(root,'tmp/tone-original-sources.json'),'utf8'))).then(result=>fs.writeFileSync(path.join(__dirname,'fixtures/conversation-tone-baseline.json'),JSON.stringify(result,null,2)+'\n'))
} else {
  test('centralization preserves every effective writing/review instruction and contextual opening byte for byte',async()=>{
    assert.deepEqual(await fingerprints(),require('./fixtures/conversation-tone-baseline.json'))
  })
  test('database prompt references expand to the exact prior content and reject unknown keys',async()=>{
    const {resolveToneReferences}=require('../src/lib/integrations/automation/conversation-tone.ts')
    const migrations=require('../operations/unificar_tono_prompts.json')
    for(const p of migrations){
      assert.equal(hash(resolveToneReferences(p.content)),p.previous_sha256)
      const ai=load('ai',undefined,{'./data':{object:v=>v,text:v=>typeof v==='string'?v:'',scope:{},rpc:async()=>({content:p.content})}})
      assert.equal(hash(await ai.activePrompt(p.name)),p.previous_sha256)
    }
    assert.equal(resolveToneReferences('Texto sin referencias.'),'Texto sin referencias.')
    assert.throws(()=>resolveToneReferences('{{conversation_tone.inexistente}}'),/UNKNOWN_CONVERSATION_TONE_REFERENCE/)
  })
}
