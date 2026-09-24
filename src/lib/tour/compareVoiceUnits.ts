import { normalizeFilters, toVoiceUnitCard, type VoiceAssistCatalogUnit, type VoiceAssistResult } from './voiceAssist'
export function compareVoiceUnits(transcript:string,catalog:VoiceAssistCatalogUnit[],previousIds:string[]=[]):VoiceAssistResult|null{
 if(!/compar|diferencia|versus|\bvs\b|cu[aá]l.*(?:mejor|grande|barat)/i.test(transcript))return null
 const codes=[...new Set(transcript.match(/\b\d{3,4}\b/g) || [])]
 const wanted=codes.length?codes.map(code=>catalog.find(u=>u.unit_number===code)):previousIds.slice(0,2).map(id=>catalog.find(u=>u.id===id))
 const units=wanted.filter((u):u is VoiceAssistCatalogUnit=>!!u).slice(0,3)
 const base={transcript,filters:normalizeFilters({only_available:false}),matches:units.map(toVoiceUnitCard),follow_up:null}
 if(wanted.some(u=>!u)||units.length<2)return {...base,speak:'Indíqueme los números de dos departamentos del catálogo para compararlos. No puedo comparar una unidad que no está publicada.'}
 const value=(v:unknown,suffix='')=>v==null||v===''?'no registrado':`${v}${suffix}`
 const lines=units.map(u=>`Unidad ${u.unit_number}: superficie ${value(u.area_total_m2,' metros cuadrados')}, ${value(u.bedrooms)} dormitorios, piso ${value(u.floor)}, precio ${value(u.price,' dólares')}, disponibilidad ${value(u.status)}.`)
 const [a,b]=units
 if(a.area_total_m2!=null&&b.area_total_m2!=null){const diff=Number((a.area_total_m2-b.area_total_m2).toFixed(2));lines.push(diff===0?'Las dos tienen la misma superficie registrada.':`La unidad ${diff>0?a.unit_number:b.unit_number} tiene ${Math.abs(diff)} metros cuadrados más.`)}
 if(a.price!=null&&b.price!=null){const diff=Number((a.price-b.price).toFixed(2));lines.push(diff===0?'El precio registrado es igual.':`La unidad ${diff>0?a.unit_number:b.unit_number} cuesta ${Math.abs(diff)} dólares más.`)}
 lines.push('La distribución y las vistas exteriores requieren los planos y recursos específicos de cada unidad; no puedo afirmar ventajas sobre esos aspectos con estos datos.')
 return {...base,speak:lines.join(' ')}
}
