import test from 'node:test'
import assert from 'node:assert/strict'
import {currentInterest,interestGroups} from './marketingInterest.logic'
test('metrics match current CRM labels without inventing evaluation evidence',()=>{
 assert.equal(currentInterest({temperature:'frio',temperature_score:0}).bucket,'frio')
 assert.equal(currentInterest({temperature:'frio',temperature_score:0,temperature_updated_at:'2026-09-23T12:00:00Z'}).bucket,'frio')
 assert.equal(currentInterest({temperature:'caliente',temperature_score:80}).bucket,'caliente')
 assert.equal(currentInterest({temperature:'tibio'}).bucket,'tibio')
 assert.equal(currentInterest({temperature:null}).bucket,'frio')
 assert.equal(currentInterest({temperature:'frio'}).evaluatedAt,null)
 assert.equal(currentInterest({temperature:'desconocido'}).bucket,'sin_clasificar')
})
test('four disjoint groups conserve unique people and current classification',()=>{
 const evidence={a:currentInterest({temperature:'frio',temperature_updated_at:'2026-09-23'}),b:currentInterest({temperature:'tibio',temperature_updated_at:'2026-09-23'})}
 const groups=interestGroups(['a','b','c','a'],evidence)
 assert.deepEqual(groups,{frio:['a'],tibio:['b'],caliente:[],sin_clasificar:['c']})
})
