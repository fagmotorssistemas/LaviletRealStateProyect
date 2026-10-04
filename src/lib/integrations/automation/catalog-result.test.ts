import test from 'node:test'
import assert from 'node:assert/strict'
import Ajv from 'ajv'
import { object, scope, type Row } from './data'
import { normalizeCatalogRequest, CATALOG_REQUEST_SCHEMA, requirementMatch } from './catalog-request'
import { completeCatalogResult, resolveCatalogRequirements, selectCatalogExamples } from './catalog-result'
import { catalogQuery } from './catalog-dialogue'
import { retrieveCatalogByEmbeddings, semanticCatalogScope } from './catalog-embeddings'
import { optimizedCatalogReply } from './optimized-catalog-reply'
import { completeTurnReply } from './turn-completeness'
import { validateBusinessFacts } from './business-facts'
import { resolvePropertyTurn, rememberPropertyReply } from './property-context'
import { normalizeTurnSemantics } from './turn-semantics'
import { promptCostComparison } from './prompt-cost-comparison'
import profileFixture from './fixtures/extractor-profile-turn.json'
import { interpretConversationTurn } from './turn-interpretation'
import { FINANCING_PROCESS_RULES } from './financing-guidance'

// Production measurements from the two reported queries, without lead identifiers.
const dimensions = [[137.98,153.21],[95.37,46.74],[52.16,null],[68.60,36.37],[94.48,32.21],[81.60,18.53],[66.43,30.22],
  [96.97,46.74],[60.69,40.73],[64.38,57.20],[46.65,8.87],[109.07,31.70],[74.43,31.51],[69.20,null],[69.75,24.80],[64.64,null]]
const locals: Row[] = dimensions.map(([interior, exterior], i) => ({ id: `local-${i+1}`, unit_number: `LC${String(i+1).padStart(2,'0')}`,
  category: 'local', floor_number: i < 7 ? 0 : 1, area_internal_m2: interior, area_exterior_m2: exterior,
  area_total_m2: null, bedrooms: null, bathrooms_full: 1, spaces: [], published_commercial_price: 145000 + i * 1000,
  is_published: true, status: 'disponible' }))
const apartments: Row[] = [2,3,4,5].map(floor => ({ id: `apt-${floor}`, unit_number: `${floor}02`, category: 'departamento',
  bedrooms: 3, bathrooms_full: 3, floor_number: floor, area_internal_m2: 120.83, area_exterior_m2: 27.03,
  published_commercial_price: 250000, status: 'disponible', is_published: true }))
const others = Array.from({length:45}, (_,i) => ({ id:`other-${i}`, unit_number:`S${i}`, category:'suite', bedrooms:1, status:'disponible' }))
const exteriorMessage = 'Cómo está, busco un local con espacio exterior'
const countMessage = 'Y cuantos departamos de 3 dormitorios tiene?'
const requirement = (field: string, operator: string, value: number | string, extra: Row = {}): Row => ({field,operator,value,upper_value:null,strength:'required',evidence:'espacio exterior',...extra})
const request = (purpose='search', requirements=[requirement('area_exterior_m2','gt',0)], extra: Row = {}): Row => ({
  version:'catalog-request-v1',purpose,metric:purpose === 'count' ? 'unit_count' : null, requirements, semantic_preferences:[],
  evidence:exteriorMessage,confidence:'high',...extra })
const info = (req=request(), category='local'): Row => ({
  catalogo:[...locals,...apartments,...others], catalogo_verificacion:[...locals,...apartments,...others], catalog_read:{complete:true},
  catalog_search:{embeddingsEnabled:true}, property_context:{}, referencia_unidad:{}, politica_comercial:{precios_autorizados:true},
  semantica_turno:{confidence:'high',primary_intent:'project_information',housing_quantities:[],budget:{status:'not_discussed'},catalog_request:req,
    property:{confidence:'high',group:category === 'local'?'commercial':'residential',category,operation:'search',query_scope:'catalog',filters:{},reference_kind:'none'}},
  contrato_turno:{objective:'project_information',required_facts:[],requests:[{domain:'property',confidence:'high',request:req.evidence,evidence:req.evidence}]},
  instalaciones:[{amenity_name:'Piscina'}],lugares_cercanos:[{poi_name:'Supermercado'}],contexto_sector:[{headline:'Educación'}],
  politicas_negocio:[{topic:'reserva',policy_content:'Reserva autorizada.'}],proyecto:{name:'La Vilet'},
})
const provider = { embed: async () => ({vector:[1],tokens:10}), match: async () => locals.map((unit,i) => ({similarity:i===0?.01:.9-i*.01,
  metadata:{...unit,...scope,unit_id:unit.id,embedding_model:'text-embedding-3-small',embedding_dimensions:1536,index_version:'unit-facts-v1'}})) }
const never = { embed: async (): Promise<{vector:number[];tokens:number}> => { throw Error('unexpected embedding call') }, match: async (): Promise<Row[]> => {throw Error('unexpected search call')} }

test('one extractor call preserves typed comparisons with embeddings enabled or disabled', async () => {
  for (const enabled of [true,false]) for (const [message,category,req] of [
    [exteriorMessage,'local',request()], [countMessage,'departamento',request('count',[requirement('bedrooms','eq',3,{evidence:'3 dormitorios'})],{evidence:countMessage})],
  ] as [string,string,Row][]) {
    const raw: Row=structuredClone(profileFixture)
    raw.full_name=raw.residence_city=null;raw.profile_evidence={full_name:null,residence_city:null,residence_country:null}
    raw.requests=[{domain:'property',request:message,evidence:message,confidence:'high'}]
    const semantics=object(raw.turn_semantics), property=object(semantics.property)
    semantics.primary_intent='project_information';semantics.primary_evidence=message
    semantics.answer_to_previous={question_id:'none',kind:'none',evidence:'',confidence:'high'}
    Object.assign(property,{group:category==='local'?'commercial':'residential',category,operation:'search',query_scope:'catalog',evidence:message})
    raw.catalog_request={...req};delete object(raw.catalog_request).version
    let calls=0
    const result=await interpretConversationTurn({mensaje_actual:message,catalog_search:{embeddingsEnabled:enabled}}, {
      activePrompt:async()=> 'Extraer el turno',aiJson:async(_rules,_data,schema)=>{
        calls++; const validate=new Ajv({strict:false}).compile(schema!)
        assert.ok(validate(raw),JSON.stringify(validate.errors))
        assert.equal(Object.hasOwn(object(schema!.properties),'catalog_request'),true)
        return structuredClone(raw)
      } })
    assert.equal(calls,1)
    assert.equal(object(result.semantics.catalog_request).purpose,req.purpose)
  }
})

test('typed query validates the schema and literal evidence, retaining unknown mandatory requirements', () => {
  const raw = request(); delete raw.version
  const validate = new Ajv({strict:false}).compile(CATALOG_REQUEST_SCHEMA)
  assert.ok(validate(raw), JSON.stringify(validate.errors))
  assert.equal(normalizeCatalogRequest(raw, exteriorMessage)?.purpose, 'search')
  assert.equal(normalizeCatalogRequest({...raw,requirements:[requirement('area_exterior_m2','gt',0,{evidence:'invented'})]},exteriorMessage),null)
  assert.equal(normalizeCatalogRequest({...raw,requirements:[requirement('unmodeled','contains','vista panorámica')]},exteriorMessage)?.version,'catalog-request-v1')
  assert.equal(requirementMatch({area_exterior_m2:null}, requirement('area_exterior_m2','eq',0)),null)
  assert.equal(requirementMatch({area_exterior_m2:0}, requirement('area_exterior_m2','eq',0)),true)
  assert.equal(requirementMatch({spaces:['Balcón']}, requirement('spaces','contains','balcon')),true)
  assert.equal(requirementMatch({spaces:['Balcón']}, requirement('spaces','not_contains','balcon')),false)
  assert.equal(requirementMatch({spaces:[]}, requirement('spaces','not_contains','balcon')),null)
})

test('real exterior query keeps all 13 confirmed locals and global extrema; 3 missing areas remain unknown', async () => {
  const result = await retrieveCatalogByEmbeddings(info(),exteriorMessage,provider)
  assert.equal(result.audit.optimized,true); assert.equal(result.audit.applied,true)
  assert.equal(result.audit.candidate_count,16); assert.equal(result.audit.matched_count,13)
  assert.equal(result.audit.unknown_count,3); assert.equal(result.units?.length,13)
  assert.equal(result.audit.examples_complete,true); assert.equal(result.audit.exhaustive,false)
  assert.ok(result.units?.some(u=>u.unit_number==='LC01'), 'low similarity must not remove a verified match')
  assert.ok(result.units?.some(u=>u.unit_number==='LC11'))
  const summary=object(result.audit.catalog_summary), stats=object(summary.statistics)
  assert.deepEqual([object(stats.area_internal_m2).min,object(stats.area_internal_m2).max],[46.65,137.98])
  assert.deepEqual([object(stats.area_exterior_m2).min,object(stats.area_exterior_m2).max],[8.87,153.21])
  assert.deepEqual((summary.unknown_units as Row[]).map(u=>u.unit_number),['LC03','LC14','LC16'])
  assert.equal(object(optimizedCatalogReply(result)?.audit.catalog_coverage).status,'answered')
})

test('count uses all matching units without an embedding request; zero and unknown are different answers', async () => {
  const req=request('count',[requirement('bedrooms','eq',3,{evidence:'3 dormitorios'})],{evidence:countMessage})
  const result=await retrieveCatalogByEmbeddings(info(req,'departamento'),countMessage,never)
  assert.equal(result.audit.optimized,true);assert.equal(result.audit.applied,false);assert.equal(result.audit.embedding_requested,false)
  assert.equal(result.audit.matched_count,4);assert.equal(result.audit.exhaustive,true);assert.equal(result.units?.length,4)
  const absent=await retrieveCatalogByEmbeddings(info(request('count',[requirement('bedrooms','eq',5)]),'departamento'),countMessage,never)
  assert.equal(object(optimizedCatalogReply(absent)?.audit.catalog_coverage).status,'no_results')
  const unknown=await retrieveCatalogByEmbeddings(info(request('count',[requirement('unmodeled','contains','vista abierta')]),'departamento'),countMessage,never)
  assert.equal(unknown.audit.unknown_count,4)
  assert.equal(object(optimizedCatalogReply(unknown)?.audit.catalog_coverage).status,'unknown')
})

test('multiple numeric conditions, inclusive boundaries and preferences are executed independently of similarity', () => {
  const req=request('search',[requirement('area_exterior_m2','gte',30),requirement('area_internal_m2','between',60,{upper_value:100}),requirement('floor_number','eq',1)])
  const data=info(req), result=completeCatalogResult(data,catalogQuery({category:'local'}),req)
  assert.deepEqual(result.units.map(u=>u.unit_number),['LC08','LC09','LC10','LC13'])
  assert.equal(requirementMatch({published_commercial_price:250000},requirement('published_commercial_price','gt',250000)),false)
  assert.equal(requirementMatch({published_commercial_price:250000},requirement('published_commercial_price','gte',250000)),true)
  const preference=request('search',[requirement('bedrooms','eq',5,{strength:'preferred'})])
  const resolved=resolveCatalogRequirements(info(preference,'departamento'),catalogQuery({category:'departamento',filters:{bedrooms:5}}),preference)
  assert.equal(completeCatalogResult(info(),resolved.query,resolved.request).units.length,4)
})

test('follow-up retains exterior requirement, updates only the changed field and resets after a category change', async () => {
  const first=optimizedCatalogReply(await retrieveCatalogByEmbeddings(info(),exteriorMessage,provider))!
  const memory=rememberPropertyReply(locals,{},first.reply,first.audit)
  const next=request('search',[requirement('area_internal_m2','gt',80)],{evidence:'y más de 80 m² interiores'})
  const data={...info(next),property_context:memory}
  const resolved=resolveCatalogRequirements(data,catalogQuery({category:'local',group:'commercial'}),next)
  assert.equal((resolved.request.requirements as Row[]).length,2)
  assert.deepEqual(completeCatalogResult(data,resolved.query,resolved.request).units.map(u=>u.unit_number),['LC01','LC02','LC05','LC06','LC08','LC12'])
  const changed=resolveCatalogRequirements(data,catalogQuery({category:'departamento',group:'residential'}),request('count',[]))
  assert.deepEqual(changed.request.requirements,[])
  const replace=resolveCatalogRequirements(data,catalogQuery({category:'local',group:'commercial'}),request('search',[requirement('area_exterior_m2','eq',0)]))
  assert.equal((replace.request.requirements as Row[]).length,1)
})

test('structured exterior measurement is not recast as interior area by lexical fallbacks', () => {
  const message='busco un local con al menos 20 m² exteriores'
  const req=request('search',[requirement('area_exterior_m2','gte',20,{evidence:'al menos 20 m² exteriores'})],{evidence:message})
  const raw={catalog_request:req,turn_semantics:{...object(info(req).semantica_turno),primary_evidence:message,
    property:{...object(object(info(req).semantica_turno).property),evidence:message}}}
  const semantics=normalizeTurnSemantics(raw,message)
  semantics.catalog_request=normalizeCatalogRequest(req,message)
  const resolved=resolvePropertyTurn(locals,message,{},[],semantics)
  assert.equal(object(object(resolved.query).filters).min_area_m2,null)
})

test('large result sets retain full counts and extrema even when only examples fit', () => {
  const units=Array.from({length:70},(_,i)=>({...locals[0],id:`u-${i}`,unit_number:String(i),area_internal_m2:i+1,area_exterior_m2:70-i,description:'x'.repeat(400)}))
  const result=completeCatalogResult({...info(),catalogo:units},catalogQuery({category:'local'}),request())
  const selected=selectCatalogExamples(result.units,request(),new Map(),4000)
  assert.ok(selected.units.length>0 && selected.units.length<70)
  assert.equal(result.summary.matching_count,70)
  assert.deepEqual([object(object(result.summary.statistics).area_internal_m2).min,object(object(result.summary.statistics).area_internal_m2).max],[1,70])
  assert.ok(selected.units.some(u=>u.unit_number==='0'));assert.ok(selected.units.some(u=>u.unit_number==='69'))
})

test('semantic service failure keeps the exact result; invalid interpretation and switch off preserve normal route', async () => {
  const failure=await retrieveCatalogByEmbeddings(info(),exteriorMessage,never)
  assert.equal(failure.audit.optimized,true);assert.equal(failure.units?.length,13)
  assert.equal(failure.audit.ranking_reason,'semantic_ranking_unavailable')
  const input=info(), original=structuredClone(input)
  const off=await retrieveCatalogByEmbeddings({...input,catalog_search:{embeddingsEnabled:false}},exteriorMessage,never)
  assert.equal(off.units,null);assert.equal(off.audit.reason,'disabled');assert.deepEqual(input,original)
  const invalid=await retrieveCatalogByEmbeddings({...input,semantica_turno:{...object(input.semantica_turno),catalog_request:null}},exteriorMessage,never)
  assert.equal(invalid.units,null);assert.equal(invalid.audit.reason,'structured_query_unavailable')
})

test('typed unit count and floor metadata are validated without confusing count with bedrooms or currency', () => {
  const group={id:'g',aggregation:'range',member_ids:apartments.map(u=>u.id),unit_count:4,floor_number:2,upper_values:{floor_number:5,unit_count:4}}
  const count={kind:'catalog_value',subject_id:'g',field:'unit_count',value:4,upper_value:null,unit:'count',relation:'eq',statement:'Hay cuatro departamentos.'}
  const floor={...count,field:'floor_number',value:2,upper_value:5,relation:'range',unit:'other',statement:'Entre las plantas 2 y 5.'}
  assert.deepEqual(validateBusinessFacts([count,floor],apartments,[group],{}).map(c=>c.status),['verified','verified'])
  assert.equal(validateBusinessFacts([{...count,value:5}],apartments,[group],{})[0].status,'contradiction')
  assert.equal(validateBusinessFacts([{...count,unit:'USD'}],apartments,[group],{})[0].status,'unverified')
})

test('count pipeline gives both agents the same four units and full summary, without the other 45 homes or a repeated review', async () => {
  const req=request('count',[requirement('bedrooms','eq',3,{evidence:'3 dormitorios'})],{evidence:countMessage})
  const input=info(req,'departamento'), retrieval=await retrieveCatalogByEmbeddings(input,countMessage,never), base=optimizedCatalogReply(retrieval)!
  const verified={...input,catalogo:retrieval.units,catalogo_verificacion:retrieval.units,catalog_context_scope:semanticCatalogScope(retrieval.audit),catalog_retrieval:retrieval.audit,catalog_summary:retrieval.audit.catalog_summary}
  const calls:{task:string;data:Row}[]=[], comparisons:Row[]=[]
  const reply='Tenemos 4 departamentos de 3 dormitorios, en las plantas 2 a 5.'
  const result=await completeTurnReply({current:countMessage,baseReply:base.reply,verified,costBaseline:input,
    audit:{...base.audit,semantic_review_enabled:true,business_risk_review_enabled:true}},async (rules,data,schema,_i,_f,_t,task)=>{
      const context=object(data);calls.push({task:task!,data:context});comparisons.push(object(promptCostComparison(rules,data,schema)))
      if(task==='writing')return {reply,question:{role:'none',purpose:'none',missing_datum:'',next_decision:''},requests:[{fragment:'R1',intent:countMessage,status:'answered',evidence:reply,fact_key:null,request_type:'general_information'}]}
      return {review_contract:'business-risk-v2',verdict:'pass',findings:[],question:null,facts:[
        {kind:'catalog_value',subject_id:'group:catalog_query:all:range',field:'unit_count',value:4,upper_value:null,unit:'count',relation:'eq',statement:'4 departamentos'},
        {kind:'catalog_value',subject_id:'group:catalog_query:all:range',field:'floor_number',value:2,upper_value:5,unit:'other',relation:'range',statement:'plantas 2 a 5'}]}
    })
  assert.equal(result.audit.status,'checked',JSON.stringify(result.audit))
  assert.deepEqual(calls.map(c=>c.task),['writing','review'])
  assert.equal((object(calls[0].data.evidencia_turno).units as Row[]).length,4)
  assert.equal((object(calls[1].data.fuentes_autorizadas).unidades as Row[]).length,4)
  assert.equal(object(object(calls[0].data.evidencia_turno).catalog_summary).matching_count,4)
  assert.equal(object(object(calls[1].data.fuentes_autorizadas).resumen_catalogo).matching_count,4)
  assert.deepEqual(object(calls[0].data.contexto_verificado).instalaciones,[])
  assert.ok(comparisons.every(c=>Number(c.normal_prompt_characters)>Number(c.actual_prompt_characters)),JSON.stringify(comparisons))
})

test('exterior search removes duplicate prompts while keeping every confirmed local and the complete summary', async () => {
  const input = info(), retrieval = await retrieveCatalogByEmbeddings(input, exteriorMessage, provider)
  const base = optimizedCatalogReply(retrieval)!
  const verified = { ...input, catalogo: retrieval.units, catalogo_verificacion: retrieval.units,
    catalog_context_scope: semanticCatalogScope(retrieval.audit), catalog_retrieval: retrieval.audit, catalog_summary: retrieval.audit.catalog_summary }
  const calls: { task: string; data: Row; rules: string }[] = [], comparisons: Row[] = []
  const reply = 'Las opciones confirmadas tienen superficies interiores de 46,65 a 137,98 m² y exteriores de 8,87 a 153,21 m².'
  const result = await completeTurnReply({ current: exteriorMessage, baseReply: base.reply, verified, costBaseline: input,
    audit: { ...base.audit, semantic_review_enabled: true, business_risk_review_enabled: true } },
    async (rules, data, schema, _image, _file, _tone, task) => {
      const context = object(data); calls.push({ task: task!, data: context, rules })
      comparisons.push(object(promptCostComparison(rules, data, schema)))
      if (task === 'writing') return { reply, question: { role: 'none', purpose: 'none', missing_datum: '', next_decision: '' },
        requests: [{ fragment: 'R1', intent: exteriorMessage, status: 'answered', evidence: reply, fact_key: null, request_type: 'general_information' }] }
      return { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], question: null, facts: [
        { kind: 'catalog_value', subject_id: 'group:catalog_query:all:range', scope: null, field: 'area_internal_m2', value: 46.65,
          upper_value: 137.98, unit: 'm2', relation: 'range', statement: 'superficies interiores de 46,65 a 137,98 m²' },
        { kind: 'catalog_value', subject_id: 'group:catalog_query:all:range', scope: null, field: 'area_exterior_m2', value: 8.87,
          upper_value: 153.21, unit: 'm2', relation: 'range', statement: 'exteriores de 8,87 a 153,21 m²' },
      ] }
    })
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.deepEqual(calls.map(c => c.task), ['writing', 'review'])
  const evidence = object(calls[0].data.evidencia_turno)
  assert.equal((evidence.units as Row[]).length, 13)
  assert.equal((object(calls[1].data.fuentes_autorizadas).unidades as Row[]).length, 13)
  assert.equal(object(evidence.catalog_summary).matching_count, 13)
  assert.equal(object(evidence.catalog_summary).unknown_count, 3)
  assert.equal(object(evidence.catalog_summary).exact_count, false)
  assert.equal((evidence.groups as Row[]).length, 3, 'the same min/max/range is not repeated four times')
  assert.equal(object(calls[0].data.contexto_verificado).estado_operativo, undefined)
  assert.equal(calls[0].data.evidencia_afirmaciones, undefined)
  assert.ok(calls.every(call => !call.rules.includes(FINANCING_PROCESS_RULES)), 'simple search does not require the financial collection procedure')
  assert.ok(Number(comparisons[0].normal_prompt_characters) > Number(comparisons[0].actual_prompt_characters), JSON.stringify(comparisons))
})
