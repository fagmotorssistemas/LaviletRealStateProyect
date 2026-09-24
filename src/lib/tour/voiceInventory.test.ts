import test from 'node:test'
import assert from 'node:assert/strict'
import { runTourVoiceAssist } from './voiceAssistServer'
import { compareVoiceUnits } from './compareVoiceUnits'
import { parseListedOptionChoice, parseVoiceFiltersLocal, mergeVoiceFilters, type VoiceAssistCatalogUnit } from './voiceAssist'

// Synthetic inventory only: no production data, model, microphone or paid service.
const catalog: VoiceAssistCatalogUnit[] = Array.from({length:8},(_,i)=>({
  id:`u${i}`,unit_number:`10${i}`,floor:'1',floor_number:1,bedrooms:i===7?2:1,
  bathrooms:1,area_total_m2:60+i,price:100000+i*1000,status:'disponible',
  category:i===0?'suite':'departamento',typology_code:null,
}))

test('one bedroom requests are searches, not selection of option one',async()=>{
  for(const transcript of ['quiero una habitación','quiero ver una habitación','¿Tienes departamentos de una habitación?','show one-bedroom apartments']){
    assert.equal(parseListedOptionChoice(transcript,1),null)
    assert.equal(parseVoiceFiltersLocal(transcript).bedrooms,1)
    const result=await runTourVoiceAssist({transcript,catalog,locale:transcript.startsWith('show')?'en':'es'})
    assert.equal(result.matches.length,3)
    assert.ok(result.matches.every(unit=>unit.bedrooms===1))
    assert.ok(result.matches.some(unit=>unit.id==='u0'),'one-bedroom suite remains eligible')
  }
})

test('more options traverse all matching inventory without repeating or substituting bedroom count',async()=>{
  let result=await runTourVoiceAssist({transcript:'busco departamentos de una habitación',catalog})
  const seen=result.matches.map(unit=>unit.id)
  for(const expected of [3,1,0]){
    result=await runTourVoiceAssist({transcript:'otras opciones',catalog,previousFilters:result.filters,previousMatches:result.matches,seenUnitIds:seen})
    assert.equal(result.matches.length,expected)
    for(const unit of result.matches){assert.ok(!seen.includes(unit.id));assert.equal(unit.bedrooms,1);seen.push(unit.id)}
  }
  assert.equal(new Set(seen).size,7)
  assert.match(result.speak,/Ya revisamos las 7/)
})

test('explicit simple search replaces old mixed-category branches',()=>{
  const filters=mergeVoiceFilters(parseVoiceFiltersLocal('locales y departamentos de dos habitaciones'),parseVoiceFiltersLocal('departamentos de una habitación'))
  assert.equal(filters.bedrooms,1)
  assert.equal(filters.or_groups,null)
})

test('comparisons resolve two units, ask when ambiguous, omit missing fields and calculate exact differences',()=>{
  const ambiguous=compareVoiceUnits('cuál es la diferencia entre uno y otro',catalog,['u0','u1','u2'])!
  assert.match(ambiguous.speak,/Cuáles dos/)
  const result=compareVoiceUnits('cuál es la diferencia entre uno y otro',catalog,['u0','u7'])!
  assert.deepEqual(result.matches.map(unit=>unit.id),['u0','u7'])
  assert.match(result.speak,/7 metros cuadrados más/)
  assert.match(result.speak,/7000 dólares más/)
  assert.match(result.speak,/1 dormitorio más/)
  const sparse=catalog.map(unit=>({...unit,price:null,area_total_m2:null,bathrooms:null}))
  const response=compareVoiceUnits('compara 100 y 101',sparse)!.speak
  assert.doesNotMatch(response,/no registrado|sin datos|not recorded|null|precio|dólares|metros cuadrados/)
})

test('repeating a search advances options, while a new bedroom request is respected',async()=>{
  const first=await runTourVoiceAssist({transcript:'busco departamentos de una habitación',catalog})
  const second=await runTourVoiceAssist({transcript:'busco departamentos de una habitación',catalog,previousFilters:first.filters,previousMatches:first.matches})
  assert.ok(second.matches.every(unit=>!first.matches.some(old=>old.id===unit.id)))
  const changed=await runTourVoiceAssist({transcript:'otras opciones de dos habitaciones',catalog,previousFilters:first.filters,previousMatches:first.matches})
  assert.deepEqual(changed.matches.map(unit=>unit.id),['u7'])
})
