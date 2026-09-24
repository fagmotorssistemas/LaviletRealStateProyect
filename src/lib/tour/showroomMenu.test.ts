import test from 'node:test'
import assert from 'node:assert/strict'
import { filterShowroomUnits, emptyUnitFilters, publicShowroomUrl } from './showroomMenu'
import { compareVoiceUnits } from './compareVoiceUnits'
import { findUnitByNumber } from './unitDeepLink'
import { pickCatalogPanoUrl } from './pickTourWidth'
import { toVoiceCatalog } from './voiceAssist'
import type { TourUnitSummary } from '@/types/tour'
const units=[{id:'a',unit_number:'201',floor:'2',category:'departamento',bedrooms:2,area_total_m2:80,published_commercial_price:100000,status:'disponible'},{id:'b',unit_number:'302',floor:'3',category:'departamento',bedrooms:3,area_total_m2:110,published_commercial_price:130000,status:'reservado'},{id:'c',unit_number:'LC-01',floor:'0',category:'local',area_total_m2:50,status:'disponible'}] as TourUnitSummary[]
test('filters distinguish homes and commercial units with real attributes',()=>{
 assert.deepEqual(filterShowroomUnits(units,{...emptyUnitFilters,floor:'2',min:'60',bedrooms:'2'}).map(u=>u.id),['a'])
 assert.deepEqual(filterShowroomUnits(units,emptyUnitFilters,true).map(u=>u.id),['c'])
 assert.deepEqual(filterShowroomUnits(units,{...emptyUnitFilters,status:'reservado'}).map(u=>u.id),['b'])
 assert.equal(filterShowroomUnits(units,{...emptyUnitFilters,min:'200'}).length,0)
})
test('deep links never pick another unit from a partial number and QR has no CRM path',()=>{
 assert.equal(findUnitByNumber(units,'20'),null)
 assert.equal(findUnitByNumber(units,'201')?.id,'a')
 assert.equal(publicShowroomUrl('LC-01','https://www.lavilett.com'), 'https://www.lavilett.com/tour?unidad=LC-01')
})
test('mobile requested image size wins over larger available file',()=>{
 assert.equal(pickCatalogPanoUrl({url:'https://x.test/full',variants:{2048:'https://x.test/small',8192:'https://x.test/large'}},2048),'https://x.test/small')
})
test('comparison uses both real rows, distinguishes missing information and unknown units',()=>{
 const catalog=toVoiceCatalog(units)
 const result=compareVoiceUnits('compara 201 y 302',catalog)!
 assert.deepEqual(result.matches.map(u=>u.id),['a','b'])
 assert.match(result.speak,/30 metros cuadrados/);assert.match(result.speak,/30000 dólares/)
 assert.doesNotMatch(result.speak,/requieren los planos/)
 assert.match(compareVoiceUnits('compara las vistas de 201 y 302',catalog)!.speak,/No puedo confirmar diferencias/)
 assert.match(compareVoiceUnits('compara 201 y 999',catalog)!.speak,/no está publicada/)
 assert.deepEqual(compareVoiceUnits('compara las dos',catalog,['a','b'])!.matches.map(u=>u.id),['a','b'])
})
