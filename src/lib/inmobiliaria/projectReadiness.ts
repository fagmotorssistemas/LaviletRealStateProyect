export const BUILD_STAGES = { not_started: 'Sin iniciar', building: 'En construcción', completed: 'Obra terminada', unknown: 'Por verificar' } as const
export const VISIT_PLACES = { office: 'Oficina', site: 'Terreno', work_area: 'Área autorizada de obra', model: 'Departamento modelo', completed_unit: 'Unidades terminadas' } as const
export type VisitPlace = keyof typeof VISIT_PLACES
export type ApprovedMaterial = { title: string; url: string; date: string; kind: 'progress' | 'render' | 'plan' | 'tour'; approved: boolean }
export type ProjectReadiness = { stage: keyof typeof BUILD_STAGES; progress: string; verifiedOn: string; enabledPlaces: VisitPlace[]; primaryPlace: VisitPlace | 'none'; conditions: string; materials: ApprovedMaterial[] }
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const validDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v
export function validateReadiness(value: unknown): ProjectReadiness {
  const v = value as ProjectReadiness
  if (!v || !Object.hasOwn(BUILD_STAGES,v.stage) || typeof v.progress !== 'string' || v.progress.length>1500 || typeof v.conditions !== 'string' || v.conditions.length>700 || !validDate(v.verifiedOn) || v.verifiedOn > new Date().toISOString().slice(0,10)) throw Error('Revise el estado, los textos y la fecha de verificación (no puede ser futura).')
  if (!Array.isArray(v.enabledPlaces) || v.enabledPlaces.some(p=>!Object.hasOwn(VISIT_PLACES,p)) || new Set(v.enabledPlaces).size!==v.enabledPlaces.length || (v.primaryPlace!=='none' && !v.enabledPlaces.includes(v.primaryPlace)) || (v.enabledPlaces.length>0 && v.primaryPlace==='none')) throw Error('Seleccione un lugar principal entre los lugares habilitados.')
  if (!Array.isArray(v.materials) || v.materials.length>12) throw Error('Puede registrar hasta 12 materiales.')
  const materials=v.materials.map(m=>{
    if (!m || typeof m.title!=='string' || !m.title.trim() || m.title.length>120 || typeof m.url!=='string' || m.url.length>1500 || !['progress','render','plan','tour'].includes(m.kind) || !validDate(m.date) || m.date>new Date().toISOString().slice(0,10) || typeof m.approved!=='boolean') throw Error('Cada material necesita título, tipo, fecha válida y enlace HTTPS.')
    let url: URL
    try {url=new URL(m.url)} catch {throw Error('El enlace del material no es válido.')}
    if(url.protocol!=='https:' || url.username || url.password) throw Error('Use enlaces HTTPS sin credenciales.')
    return {title:m.title.trim(),url:url.href,date:m.date,kind:m.kind,approved:m.approved}
  })
  return {stage:v.stage,progress:v.progress.trim(),verifiedOn:v.verifiedOn,enabledPlaces:[...v.enabledPlaces],primaryPlace:v.primaryPlace,conditions:v.conditions.trim(),materials}
}
export function projectReadiness(policies: unknown, mode: string): { configured: boolean; value: ProjectReadiness } {
  const p=obj(policies), saved=obj(p.project_readiness)
  if (saved.current) return {configured:true,value:validateReadiness(saved.current)}
  // Preserve the existing configuration until an administrator explicitly saves.
  const primaryPlace=obj(p.bot_visits).launch_destination==='office'?'office':'site'
  return {configured:false,value:{stage:mode==='lanzamiento'?'not_started':'unknown',progress:'',verifiedOn:new Date().toISOString().slice(0,10),enabledPlaces:[primaryPlace],primaryPlace,conditions:'',materials:[]}}
}
export function readinessRules(v: ProjectReadiness): string {
  return `ESTADO FÍSICO VERIFICADO: ${BUILD_STAGES[v.stage]}. Actualizado: ${v.verifiedOn}. ${v.progress}\nLa etapa comercial no determina el avance físico. No deduzca avances por el tiempo transcurrido. Lugares autorizados: ${v.enabledPlaces.map(p=>VISIT_PLACES[p]).join(', ')||'ninguno'}. Lugar principal: ${v.primaryPlace==='none'?'ninguno':VISIT_PLACES[v.primaryPlace]}. Condiciones: ${v.conditions||'coordinar disponibilidad antes de confirmar'}. No prometa acceso a otros lugares ni unidades. Departamento modelo no equivale a todas las unidades terminadas. Comparta únicamente materiales autorizados; identifique fotos de avance con su fecha, y renders como representaciones. Una oferta de visita debe terminar con UNA pregunta clara de aceptación, sin ofrecer simultáneamente otra acción. No afirme haber enviado material sin incluir el enlace correspondiente.`
}
export function botReadiness(v: ProjectReadiness): ProjectReadiness {return {...v,materials:v.materials.filter(m=>m.approved)}}
export function readinessMaterialReply(v:ProjectReadiness,current:string):string {
  const text=current.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  if(!/foto|imagen|video|material|avances/.test(text)|| !/envie|enviame|compart|muestre|ver|visual|avances|tiene.*foto/.test(text))return ''
  const materials=v.materials.filter(m=>m.approved && (!/avance|obra|construccion/.test(text)||m.kind==='progress')).slice(0,3)
  if(!materials.length)return 'Por el momento no tengo material autorizado para compartir sobre esa consulta.'
  const labels={progress:'Avance real',render:'Render: representación del diseño',plan:'Plano',tour:'Recorrido virtual'}
  return 'Puede revisar este material del proyecto:\n'+materials.map(m=>`${m.title} — ${labels[m.kind]} (${m.date}): ${m.url}`).join('\n')
}
export function readinessInvitation(v: ProjectReadiness): string {
  if(v.primaryPlace==='none')return ''
  const place={office:'a nuestra oficina para revisar el proyecto',site:'al terreno del proyecto',work_area:'al área de obra autorizada',model:'al departamento modelo',completed_unit:'a las unidades terminadas habilitadas'}[v.primaryPlace]
  return `¿Le gustaría coordinar una visita ${place}?`
}
