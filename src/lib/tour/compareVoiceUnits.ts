import { normalizeFilters, toVoiceUnitCard, type VoiceAssistCatalogUnit, type VoiceAssistResult } from './voiceAssist'
import { isVoiceComparison, normalizeVoiceText } from './voiceTurnIntent'
import { translateTourText, type TourLocale } from './tourMessages'
export function compareVoiceUnits(transcript:string,catalog:VoiceAssistCatalogUnit[],previousIds:string[]=[],locale:TourLocale='es'):VoiceAssistResult|null{
 if(!isVoiceComparison(transcript))return null
 const t=normalizeVoiceText(transcript).replace(/\bfirst\b/g,'primera').replace(/\bsecond\b/g,'segunda').replace(/\bthird\b/g,'tercera').replace(/\boptions?\b/g,'opcion').replace(/\band\b/g,'y')
 const codes=[...new Set(t.match(/\blc[- ]?\d{1,3}\b|\b\d{3,4}\b/g) || [])]
 const normalizeCode=(code:string)=>code.replace(/[- ]/g,'').toLowerCase()
 const positions: number[]=[]
 for(const match of t.matchAll(/\b(primer[ao]?|segund[ao]|tercer[ao]?)\b|\bopcion\s*([123])\b/g)) {
   positions.push(match[2]?Number(match[2])-1:/^prim/.test(match[1])?0:/^seg/.test(match[1])?1:2)
 }
 const pair=t.match(/\bopciones?\s*([123])\s*(?:y|con|vs)\s*(?:la\s+)?([123])\b/)
 if(pair)positions.push(Number(pair[1])-1,Number(pair[2])-1)
 // Una recomendación abierta necesita entender la necesidad, no inventar dos unidades elegidas.
 if(!codes.length&&!positions.length&&previousIds.length<2)return null
 const ids=positions.length?[...new Set(positions)].map(position=>previousIds[position]):previousIds
 if(!codes.length&&!positions.length&&previousIds.length>2&&!/\b(tres|todas|three|all)\b/.test(t))return {transcript,filters:normalizeFilters({}),matches:previousIds.flatMap(id=>{const u=catalog.find(u=>u.id===id);return u?[toVoiceUnitCard(u)]:[]}),follow_up:null,speak:locale==='en'?'Which two would you like to compare: the first, second or third?':'¿Cuáles dos quiere comparar: la primera, la segunda o la tercera?'}
 const wanted=codes.length?codes.map(code=>catalog.find(u=>normalizeCode(u.unit_number)===normalizeCode(code))):ids.map(id=>catalog.find(u=>u.id===id))
 const units=wanted.filter((u):u is VoiceAssistCatalogUnit=>!!u).filter((u,index,list)=>list.findIndex(other=>other.id===u.id)===index).slice(0,3)
 const base={transcript,filters:normalizeFilters({only_available:false}),matches:units.map(toVoiceUnitCard),follow_up:null}
 if(wanted.some(u=>!u)||units.length<2)return {...base,speak:locale==='en'?'Please give me the numbers of two published units to compare. I cannot compare a unit that is not in the published inventory.':'Indíqueme los números de dos departamentos del catálogo para compararlos. No puedo comparar una unidad que no está publicada.'}
 const en=locale==='en'
 const lines=units.map(u=>{
   const facts=[u.area_total_m2!=null?`${u.area_total_m2} ${en?'square meters':'metros cuadrados'}`:null,
     u.bedrooms!=null?`${u.bedrooms} ${en?'bedrooms':'dormitorios'}`:null,
     u.bathrooms!=null?`${u.bathrooms} ${en?'bathrooms':'baños'}`:null,
     u.floor?`${en?'floor':'piso'} ${translateTourText(u.floor,locale)}`:null,
     u.price!=null?`${u.price} ${en?'dollars':'dólares'}`:null,
     u.status?translateTourText(u.status,locale):null].filter(Boolean)
   return `${en?'Unit':'Unidad'} ${u.unit_number}${facts.length?`: ${facts.join(', ')}`:''}.`
 })
 for(let i=0;i<units.length-1;i++)for(let j=i+1;j<units.length;j++){
 const a=units[i],b=units[j]
 lines.push(en?`Comparing ${a.unit_number} and ${b.unit_number}:`:`Entre ${a.unit_number} y ${b.unit_number}:`)
 if(a.area_total_m2!=null&&b.area_total_m2!=null){const diff=Number((a.area_total_m2-b.area_total_m2).toFixed(2));lines.push(locale==='en'?(diff===0?'Both have the same recorded area.':`Unit ${diff>0?a.unit_number:b.unit_number} has ${Math.abs(diff)} more square meters.`):(diff===0?'Las dos tienen la misma superficie registrada.':`La unidad ${diff>0?a.unit_number:b.unit_number} tiene ${Math.abs(diff)} metros cuadrados más.`))}
 if(a.price!=null&&b.price!=null){const diff=Number((a.price-b.price).toFixed(2));lines.push(locale==='en'?(diff===0?'Both have the same recorded price.':`Unit ${diff>0?a.unit_number:b.unit_number} costs ${Math.abs(diff)} dollars more.`):(diff===0?'El precio registrado es igual.':`La unidad ${diff>0?a.unit_number:b.unit_number} cuesta ${Math.abs(diff)} dólares más.`))}
 for(const field of ['bedrooms','bathrooms'] as const){
   if(a[field]==null||b[field]==null)continue
   const diff=a[field]!-b[field]!
   const count=diff===0?a[field]:Math.abs(diff)
   const label=(en?(field==='bedrooms'?'bedroom':'bathroom'):(field==='bedrooms'?'dormitorio':'baño'))+(count===1?'':'s')
   lines.push(diff===0?(en?`Both have ${a[field]} ${label}.`:`Ambas tienen ${a[field]} ${label}.`):(en?`Unit ${diff>0?a.unit_number:b.unit_number} has ${Math.abs(diff)} more ${label}.`:`La unidad ${diff>0?a.unit_number:b.unit_number} tiene ${Math.abs(diff)} ${label} más.`))
 }
 }
 if(/vista|distribucion|terraza|ventana|orientacion|view|layout|terrace|window/.test(t))lines.push(en?'I cannot confirm differences in layout or views.':'No puedo confirmar diferencias de distribución o vistas.')
 if(/financi|cuota|credito|descuento|loan|discount/.test(t))lines.push(locale==='en'?'I do not have confirmed financing terms or discounts for these units.':'No tengo condiciones de financiación o descuentos confirmados para estas unidades.')
 if(/mejor|conviene|recomiend|better|best|recommend/.test(t))lines.push(locale==='en'?'Would you prefer to prioritize your budget, space or floor?':'Para recomendarle una, ¿prefiere priorizar el presupuesto, el espacio o el piso?')
 return {...base,speak:lines.join(' ')}
}
