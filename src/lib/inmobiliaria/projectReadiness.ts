export const BUILD_STAGES = { not_started: 'Sin iniciar', building: 'En construcción', completed: 'Obra terminada', unknown: 'Por verificar' } as const
export const VISIT_PLACES = { office: 'Oficina', site: 'Terreno', work_area: 'Área autorizada de obra', model: 'Departamento modelo', completed_unit: 'Unidades terminadas' } as const
export type VisitPlace = keyof typeof VISIT_PLACES
export type ProjectReadiness = { stage: keyof typeof BUILD_STAGES; progress: string; verifiedOn: string; enabledPlaces: VisitPlace[]; primaryPlace: VisitPlace | 'none'; conditions: string }
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const validDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v
export function validateReadiness(value: unknown): ProjectReadiness {
  const v = value as ProjectReadiness
  if (!v || !Object.hasOwn(BUILD_STAGES,v.stage) || typeof v.progress !== 'string' || v.progress.length>1500 || typeof v.conditions !== 'string' || v.conditions.length>700 || !validDate(v.verifiedOn) || v.verifiedOn > new Date().toISOString().slice(0,10)) throw Error('Revise el estado, los textos y la fecha de verificación (no puede ser futura).')
  if (!Array.isArray(v.enabledPlaces) || v.enabledPlaces.some(p=>!Object.hasOwn(VISIT_PLACES,p)) || new Set(v.enabledPlaces).size!==v.enabledPlaces.length || (v.primaryPlace!=='none' && !v.enabledPlaces.includes(v.primaryPlace)) || (v.enabledPlaces.length>0 && v.primaryPlace==='none')) throw Error('Seleccione un lugar principal entre los lugares habilitados.')
  return {stage:v.stage,progress:v.progress.trim(),verifiedOn:v.verifiedOn,enabledPlaces:[...v.enabledPlaces],primaryPlace:v.primaryPlace,conditions:v.conditions.trim()}
}
export function projectReadiness(policies: unknown, mode: string): { configured: boolean; value: ProjectReadiness } {
  const p=obj(policies), saved=obj(p.project_readiness)
  if (saved.current) return {configured:true,value:validateReadiness(saved.current)}
  // Preserve the existing configuration until an administrator explicitly saves.
  const primaryPlace=obj(p.bot_visits).launch_destination==='office'?'office':'site'
  return {configured:false,value:{stage:mode==='lanzamiento'?'not_started':'unknown',progress:'',verifiedOn:new Date().toISOString().slice(0,10),enabledPlaces:[primaryPlace],primaryPlace,conditions:''}}
}
export function readinessRules(v: ProjectReadiness): string {
  return `ESTADO FÍSICO VERIFICADO: ${BUILD_STAGES[v.stage]}. Actualizado: ${v.verifiedOn}. ${v.progress}\nLa etapa comercial no determina el avance físico. No deduzca avances por el tiempo transcurrido. Lugares autorizados: ${v.enabledPlaces.map(p=>VISIT_PLACES[p]).join(', ')||'ninguno'}. Lugar principal: ${v.primaryPlace==='none'?'ninguno':VISIT_PLACES[v.primaryPlace]}. Condiciones: ${v.conditions||'coordinar disponibilidad antes de confirmar'}. No prometa acceso a otros lugares ni unidades. Departamento modelo no equivale a todas las unidades terminadas. Una oferta de visita debe terminar con UNA pregunta clara de aceptación, sin ofrecer simultáneamente otra acción.`
}
const PLACE_PHRASES: Record<VisitPlace,string> = {
  office:'nuestra oficina para revisar el proyecto',
  site:'el terreno del proyecto',
  work_area:'el área autorizada de obra',
  model:'el departamento modelo',
  completed_unit:'las unidades terminadas habilitadas',
}
const PLACE_DESTINATIONS: Record<VisitPlace,string> = {
  office:'en nuestra oficina para revisar el proyecto',
  site:'en el terreno del proyecto',
  work_area:'en el área autorizada de obra',
  model:'en el departamento modelo',
  completed_unit:'en las unidades terminadas habilitadas',
}
function orderedVisitPlaces(v: ProjectReadiness) {
  return v.primaryPlace === 'none' ? [...v.enabledPlaces]
    : [v.primaryPlace,...v.enabledPlaces.filter(place=>place!==v.primaryPlace)]
}
function joinedPlaces(places: VisitPlace[]) {
  const labels=places.map(place=>PLACE_PHRASES[place])
  return labels.length<2 ? labels[0]||'' : labels.length===2 ? `${labels[0]} o ${labels[1]}` : `${labels.slice(0,-1).join(', ')} o ${labels.at(-1)}`
}
export function readinessInvitation(v: ProjectReadiness): string {
  if(v.primaryPlace==='none')return ''
  const places=orderedVisitPlaces(v)
  const destinations=places.map(place=>PLACE_DESTINATIONS[place])
  const choices=destinations.length===2?`${destinations[0]} o ${destinations[1]}`:destinations.length>2?`${destinations.slice(0,-1).join(', ')} o ${destinations.at(-1)}`:destinations[0]
  return `¿Le gustaría coordinar una visita ${choices}?`
}
export function readinessPlaceClarification(v: ProjectReadiness,current:string): string {
  const message=current.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  if(!/\b(?:solo|solamente|unicamente|tambien|otra opcion|otro lugar)\b/.test(message)
    || !/\b(?:terreno|oficina|obra|departamento modelo|unidad(?:es)? terminada)\b/.test(message))return ''
  const places=orderedVisitPlaces(v)
  if(!places.length)return 'Por el momento no hay visitas presenciales habilitadas.'
  if(places.length===1)return `Por ahora, la visita presencial habilitada es a ${joinedPlaces(places)}. ¿Desea coordinarla?`
  const unavailable=v.enabledPlaces.includes('completed_unit')?'':' Las unidades terminadas todavía no están habilitadas para recorridos.'
  return `Puede elegir entre visitar ${joinedPlaces(places)}.${unavailable} ¿Cuál opción prefiere?`
}
