'use client'
/* eslint-disable @next/next/no-img-element -- QR is generated locally as a data URL. */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTourLanguage } from '@/lib/tour/tourLocale'
import type { TourLocale } from '@/lib/tour/tourMessages'
import { Menu, X, Maximize, Minimize, ArrowLeft, Home, Search, Store, Scan, Trees, HardHat, MapPin, ChevronRight, ChevronDown, Mail, Ruler, BedDouble, Images, QrCode, Box } from 'lucide-react'
import { FocusScope } from 'react-aria'
import QRCode from 'qrcode'
import type { TourPublicCatalog, TourUnitSummary } from '@/types/tour'
import { UNIT_STATUS_OPTIONS } from '@/types/inmobiliaria'
import { UNIT_MODEL_ORIGIN, unitModelUrl } from '@/lib/tour/unitModels'
import { SITE } from '@/lib/marketing/site'
import { constructionProgress } from '@/lib/tour/constructionProgress'
import { emptyUnitFilters, filterShowroomUnits, publicShowroomUrl } from '@/lib/tour/showroomMenu'
import { parseFloorNumber } from '@/lib/tour/floorPlanHotspots'
type Section='home'|'units'|'shops'|'tour'|'amenities'|'progress'|'contact'
const names={es:['Inicio / edificio','Buscar departamentos','Locales comerciales','Departamento modelo / 360°','Amenidades','Avance de obra','Ubicación'],en:['Home / building','Find an apartment','Commercial units','Model apartment / 360°','Amenities','Construction progress','Location']}
const icons=[Home,Search,Store,Scan,Trees,HardHat,MapPin]
const sections:Section[]=['home','units','shops','tour','amenities','progress','contact']
const menuSelectClass='appearance-none rounded-xl border border-[#bda27e]/50 bg-white py-2 pr-8 pl-3 text-sm text-[#29251e] focus-visible:outline-2 focus-visible:outline-[#8e7654]'
const languageOptions: { value: TourLocale; label: string }[] = [{ value: 'es', label: 'Español' }, { value: 'en', label: 'English' }]
function MenuSelect({ label, value, options, disabled, onChange, placement = 'below', align = 'stretch' }: { label: string; value: string; options: { value: string; label: string }[]; disabled?: boolean; onChange: (value: string) => void; placement?: 'below' | 'above'; align?: 'stretch' | 'end' }) {
 const [open, setOpen] = useState(false)
 const root = useRef<HTMLDivElement>(null)
 useEffect(() => {
  if (!open) return
  const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
  document.addEventListener('mousedown', close)
  return () => document.removeEventListener('mousedown', close)
 }, [open])
 const current = options.find(option => option.value === value)?.label ?? ''
 return <div ref={root} className={`relative ${align === 'stretch' ? 'mt-1' : ''}`}>
  <button type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen(next => !next)} className={`${menuSelectClass} block truncate text-left ${align === 'stretch' ? 'w-full' : 'min-w-[6.4rem]'} ${disabled ? 'cursor-not-allowed' : ''}`}>{current}</button>
  <ChevronDown size={14} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[#8e7654]" />
  {open ? <ul role="listbox" aria-label={label} className={`absolute z-30 max-h-64 overflow-y-auto rounded-xl border border-[#bda27e]/50 bg-white py-1 shadow-[0_12px_32px_rgba(41,37,30,0.14)] ${placement === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'} ${align === 'end' ? 'right-0 min-w-full' : 'left-0 w-full'}`}>{options.map(option => <li key={option.value || 'all'} role="option" aria-selected={value === option.value}><button type="button" onClick={() => { onChange(option.value); setOpen(false) }} className={`block w-full px-3 py-2 text-left text-sm leading-snug text-[#29251e] ${value === option.value ? 'bg-[#ded3c1]' : 'hover:bg-[#eae3d8]'}`}>{option.label}</button></li>)}</ul> : null}
 </div>
}
function shopFloorLabel(floor: string, label: (es: string, en: string) => string) {
  const text = floor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (text.includes('baja')) return label('Planta baja', 'Ground floor')
  if (text.includes('alta')) return label('Planta alta', 'Upper floor')
  return floor
}
function categoryLabel(value: string, label: (es: string, en: string) => string) {
  const key = value.toLowerCase()
  if (key === 'departamento') return label('Departamento', 'Apartment')
  if (key === 'local') return label('Local', 'Commercial unit')
  if (key === 'suite') return label('Suite', 'Suite')
  if (key === 'penthouse') return label('Penthouse', 'Penthouse')
  return value
}
function statusLabel(value: string, translate: (text: string) => string) {
  const label = UNIT_STATUS_OPTIONS.find(item => item.value === value)?.label ?? value.replace(/[_-]+/g, ' ').replace(/\b\p{L}/gu, letter => letter.toLocaleUpperCase('es'))
  return translate(label)
}
function bedroomsApply(category: string) {
  return ['departamento', 'suite', 'penthouse'].includes(category.toLowerCase())
}
function shopFloorRank(floor: string) {
  const text = floor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (text.includes('baja')) return 0
  if (text.includes('alta')) return 1
  return 2
}
function formatArea(value: number) {
  return String(Math.round(value * 100) / 100)
}
function floorRank(floor: string) {
  const level = parseFloorNumber(floor)
  return level == null ? 100 : level
}
function isPenthouse(unit: TourUnitSummary, typology?: { name?: string | null; category?: string | null } | null) {
  const category = (unit.category ?? '').toLowerCase()
  const code = (unit.typology_code ?? '').toLowerCase()
  const name = `${typology?.name ?? ''} ${typology?.category ?? ''}`.toLowerCase()
  return category === 'penthouse' || code.includes('penthouse') || name.includes('penthouse')
}
function statusTone(status: string) {
  const key = status.toLowerCase()
  if (key.includes('dispon')) return 'bg-[#e5f2e6] text-[#246b32]'
  if (key.includes('reserv')) return 'bg-[#f4ead7] text-[#8a6230]'
  if (key.includes('vend')) return 'bg-[#ece7e1] text-[#6d645b]'
  return 'bg-[#efe8dc] text-[#756044]'
}
function isIosShowroom() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/iPad|iPhone|iPod/.test(ua)) return true
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}
function isIPhoneSafari() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (!/iPhone/.test(ua) || /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return false
  return /Safari/.test(ua)
}
function isInstalledShowroom() {
  if (typeof window === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  if (nav.standalone) return true
  return window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches
}
const HOME_HINT_KEY = 'lavilet-tour-a2hs'
export function ShowroomMenu({units,catalog,selected,place,onHome,onPick,onTour,onAmenities,onClosePanels,root,hideWebReturn=false,hidden=false}:{units:TourUnitSummary[];catalog:TourPublicCatalog|null;selected:TourUnitSummary|null;place:Section;onHome:(view?:'image'|'plan')=>void;onPick:(u:TourUnitSummary)=>void;onTour:(u:TourUnitSummary)=>void;onAmenities:()=>void;onClosePanels:()=>void;root:React.RefObject<HTMLDivElement|null>;hideWebReturn?:boolean;hidden?:boolean}){
 const [content,setContent]=useState(false)
 const [open,setOpen]=useState(false),[section,setSection]=useState<Section>('home')
 const {locale:lang,setLocale:setLang,t:translate}=useTourLanguage()
 const [filters,setFilters]=useState(emptyUnitFilters),[full,setFull]=useState(false),[notice,setNotice]=useState(''),[share,commitShare]=useState<TourUnitSummary|null>(null),[qr,setQr]=useState(''),[ios,setIos]=useState(false),[homeHint,setHomeHint]=useState(false)
 const shareUrl=share?publicShowroomUrl(share.unit_number,UNIT_MODEL_ORIGIN)+(lang==='en'?'&lang=en':''):''
 const setShare=(unit:TourUnitSummary|null)=>{setQr('');commitShare(unit)}
 const router=useRouter()
 const button=useRef<HTMLButtonElement>(null)
 const t=(es:string,en:string)=>lang==='es'?es:en
 useEffect(()=>{const sync=()=>setFull(!!document.fullscreenElement);document.addEventListener('fullscreenchange',sync);return()=>document.removeEventListener('fullscreenchange',sync)},[])
 useEffect(()=>{setIos(isIosShowroom());if(!isIPhoneSafari()||isInstalledShowroom())return;try{if(localStorage.getItem(HOME_HINT_KEY)==='1')return}catch{return}setHomeHint(true)},[])
 useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(''),3000);return()=>window.clearTimeout(timer)},[notice])
 useEffect(()=>{if(!open)return;const close=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);button.current?.focus()}};document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close)},[open])
 useEffect(()=>{if(!share)return;let active=true;const url=publicShowroomUrl(share.unit_number,UNIT_MODEL_ORIGIN)+(lang==='en'?'&lang=en':'');void QRCode.toDataURL(url,{width:224,margin:4,errorCorrectionLevel:'M'}).then(value=>{if(active)setQr(value)}).catch(()=>{if(active)setNotice('No se pudo generar el QR; use el enlace.')});return()=>{active=false}},[share,lang])
 const choices=(key:'floor'|'category'|'status'|'bedrooms')=>[...new Set(units.map(u=>u[key]).filter(v=>v!=null && v!==''))].sort((a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true}))
 const floorsFor=(next:typeof filters)=>[...new Set(filterShowroomUnits(units,{...next,floor:''},section==='shops').map(unit=>unit.floor).filter((floor):floor is string=>Boolean(floor)))].sort((a,b)=>(section==='shops'?shopFloorRank(a)-shopFloorRank(b):floorRank(a)-floorRank(b))||a.localeCompare(b,'es'))
 const optionValues=(key:'floor'|'category'|'status'|'bedrooms')=>key==='floor'?floorsFor(filters):choices(key).map(value=>String(value))
 const filtered=filterShowroomUnits(units,filters,section==='shops')
 const floorGroups=[...filtered.reduce((groups,unit)=>{const floor=unit.floor||'';const list=groups.get(floor)??[];list.push(unit);groups.set(floor,list);return groups},new Map<string,TourUnitSummary[]>())].sort(([a],[b])=>(section==='shops'?shopFloorRank(a)-shopFloorRank(b):floorRank(a)-floorRank(b))||a.localeCompare(b,'es'))
 const close=()=>{setOpen(false);button.current?.focus()}
 const go=(next:Section)=>{setShare(null);setNotice('');if(next==='amenities'){onAmenities();close();return}if(next==='contact'){router.push('/ubicanos');close();return}setContent(true);setSection(next);if(next==='units'||next==='shops'||next==='tour')setFilters(emptyUnitFilters);if(next==='home'){onHome();close()}else onClosePanels()}
 async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else if(root.current?.requestFullscreen)await root.current.requestFullscreen();else setNotice(t('Este navegador no permite pantalla completa.','Fullscreen is unavailable in this browser.'))}catch{setNotice(t('No se pudo cambiar a pantalla completa.','Fullscreen could not be changed.'))}}
 const fields=[['floor',t('Piso','Floor')],['bedrooms',t('Dormitorios','Bedrooms')],['category',t('Tipo','Type')],['status',t('Disponibilidad','Availability')]] as const
 if (hidden) return null
 return <>
  <div role="toolbar" aria-label="Controles del showroom" data-showroom-toolbar className="absolute inset-x-0 top-0 z-[90] flex h-[calc(4rem+env(safe-area-inset-top))] items-center gap-2 bg-transparent px-3 pt-[env(safe-area-inset-top)] text-[#f7f3ee] [text-shadow:0_1px_3px_rgba(20,17,14,0.85)] sm:px-5">
   <button ref={button} type="button" data-showroom-menu aria-label={t('Abrir menú del showroom','Open showroom menu')} aria-expanded={open} onClick={()=>{onClosePanels();setContent(false);setShare(null);setNotice('');setOpen(true)}} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#bda27e]/50 bg-[#29251e]/90 p-0 text-[#f7f3ee]"><Menu size={20}/></button>
   {ios?null:<button type="button" aria-label={full?t('Salir de pantalla completa','Exit fullscreen'):t('Pantalla completa','Fullscreen')} onClick={()=>void fullscreen()} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#bda27e]/50 bg-[#29251e]/90 p-0 text-[#f7f3ee]">{full?<Minimize size={20}/>:<Maximize size={20}/>}</button>}
   {open ? null : <span className="ml-2 min-w-0 truncate font-serif text-sm tracking-[.22em] sm:text-lg">LA VILET</span>}
   {hideWebReturn ? null : <a href="/inicio" aria-label={t('Volver a la página web','Back to website')} title={t('Volver a la página web','Back to website')} className={`ml-auto inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-[#bda27e]/50 bg-[#29251e]/90 px-3 text-xs text-[#f7f3ee] [text-shadow:none] transition-colors hover:bg-[#3a342b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#bda27e] ${place==='home'?'mr-[4.75rem]':''}`}>
    <ArrowLeft size={16} aria-hidden="true"/><span className="sm:hidden">{t('Volver','Back')}</span><span className="hidden sm:inline">{t('Volver a la web','Back to website')}</span>
   </a>}
  </div>
  {!open && notice?<p role="status" className={`pointer-events-none absolute left-[max(0.75rem,env(safe-area-inset-left))] z-[80] max-w-[min(16rem,calc(100%-9.5rem-env(safe-area-inset-right)))] rounded bg-[#f7f3ee]/95 px-3 py-2 text-xs text-[#29251e] shadow-md ${homeHint?'top-[calc(4rem+env(safe-area-inset-top)+4.6rem)]':'top-[calc(4rem+env(safe-area-inset-top)+0.4rem)]'}`}>{notice}</p>:null}
  {homeHint?<div className="absolute top-[calc(4rem+env(safe-area-inset-top)+0.4rem)] left-[max(0.75rem,env(safe-area-inset-left))] z-[80] flex w-[min(18rem,calc(100%-9.5rem-env(safe-area-inset-right)))] items-start gap-2 rounded-xl bg-[#f7f3ee]/95 px-3 py-2 text-[11px] leading-snug text-[#29251e] shadow-md"><p className="min-w-0 flex-1">{t('Para verlo en pantalla completa: Compartir → Agregar a pantalla de inicio','For fullscreen: Share → Add to Home Screen')}</p><button type="button" aria-label={t('Cerrar aviso','Dismiss notice')} onClick={()=>{try{localStorage.setItem(HOME_HINT_KEY,'1')}catch{/* el aviso no vuelve en esta visita */}setHomeHint(false)}} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[#756044]"><X size={14}/></button></div>:null}
  {open?<div className="absolute inset-0 z-[200] flex bg-black/30 p-2 sm:p-3" onClick={close}>
   <FocusScope contain restoreFocus autoFocus><aside role="dialog" aria-modal="true" aria-label={t('Menú La Vilet','La Vilet menu')} lang={lang} onClick={e=>e.stopPropagation()} className={`flex h-full w-full flex-col overflow-y-auto rounded-2xl bg-[#f7f3ee] p-5 text-[#29251e] shadow-2xl ${!content?'max-w-[calc(320px+1cm)]':'max-w-md'}`}>
    <header className="flex items-center justify-between border-b border-[#bda27e]/40 pb-4"><div><p className="font-serif text-3xl tracking-[.16em]">LA VILET</p><p className="mt-2 text-xs">{SITE.city}</p></div><button type="button" aria-label={t('Cerrar menú','Close menu')} onClick={close} className="rounded-full border border-[#bda27e]/50 p-2"><X/></button></header>
    {!content?<nav aria-label={t('Secciones','Sections')} className="my-4 flex flex-1 flex-col justify-between gap-2">{sections.map((key,i)=>{const Icon=icons[i];const here=place===key;return <button type="button" key={key} aria-current={here?'page':undefined} onClick={()=>go(key)} className={`flex min-h-12 flex-1 items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-[#8e7654] ${here?'bg-[#ded3c1] font-medium':'hover:bg-[#eae3d8]'}`}><Icon size={18} strokeWidth={1.5} className="shrink-0 text-[#8e7654]"/><span className="flex-1">{names[lang][i]}</span><ChevronRight size={14} className="shrink-0 text-[#8e7654]"/></button>})}</nav>:<button type="button" onClick={()=>{setContent(false);setShare(null);setNotice('')}} className="my-4 flex min-h-11 items-center gap-2 self-start text-sm text-[#756044]"><ArrowLeft size={18}/>{t('Volver al menú','Back to menu')}</button>}
    {content?<div className="flex-1">
    {(section==='units'||section==='shops'||section==='tour')?<section>
     <h2 className="mb-3 font-serif text-2xl">{names[lang][sections.indexOf(section)]}</h2>
     {section==='shops'?<p className="mb-3 text-sm leading-relaxed text-[#756044]">{t('Los locales comerciales están solo en planta baja y en la primera planta.','Commercial units are only on the ground floor and the first floor.')}</p>:null}
     {section!=='tour'?<div className="mb-4 grid grid-cols-2 gap-2">
      {fields.filter(([key])=>section!=='shops'||(key!=='bedrooms'&&key!=='category')).map(([key,label])=>{const locked=key==='bedrooms'&&!bedroomsApply(filters.category);const options=[{value:'',label:t('Todos','All')},...optionValues(key).map(value=>({value,label:key==='floor'&&section==='shops'?shopFloorLabel(value,t):key==='category'?categoryLabel(value,t):key==='status'?statusLabel(value,translate):translate(value)}))];return <div key={key} className={`text-xs text-[#756044] ${locked?'opacity-45':''}`}>{label}<MenuSelect label={label} value={locked?'':filters[key]} disabled={locked} options={options} onChange={value=>{const next={...filters,[key]:value};if(key==='category'&&!bedroomsApply(value))next.bedrooms='';if(key!=='floor'&&next.floor&&!floorsFor(next).includes(next.floor))next.floor='';setFilters(next)}}/></div>})}
      <button type="button" onClick={()=>setFilters(emptyUnitFilters)} className="col-span-2 text-left text-xs underline">{t('Limpiar filtros','Clear filters')}</button>
     </div>:<p className="mb-3 text-sm">{t('Elija una unidad. Los recursos de tipología se muestran como referencia, no como una vista exterior exclusiva.','Choose a unit. Typology resources are references, not a verified exterior view from that unit.')}</p>}
     <p className="mb-3 text-[11px] tracking-[0.16em] text-[#8e7654] uppercase">{filtered.length} {section==='shops'?t('locales','units'):t('unidades','units')}</p>
     <div className="flex flex-col gap-5">{floorGroups.map(([floor,group])=><section key={floor||'sin-piso'}><h3 className="mb-2 text-[11px] font-semibold tracking-[0.16em] text-[#8e7654] uppercase">{section==='shops'?shopFloorLabel(floor,t):(floor||'—')}</h3><ul className="flex flex-col gap-3">{group.map(u=>{const typ=catalog?.typologies.find(v=>(u.unit_type_id&&v.id===u.unit_type_id)||(u.typology_code&&v.code===u.typology_code));const local=u.category==='local'||typ?.category==='local';const model=unitModelUrl({...u});return <li key={u.id} className="rounded-2xl border border-[#bda27e]/35 bg-white/80 p-4 shadow-[0_10px_30px_rgba(41,37,30,0.06)]"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] tracking-[0.22em] text-[#8e7654] uppercase">{local?t('Local comercial','Commercial unit'):isPenthouse(u,typ)?'Penthouse':t('Departamento','Apartment')}</p><p className="font-serif text-[1.65rem] leading-none tracking-wide text-[#29251e]">{u.unit_number}</p></div><span className="flex shrink-0 flex-col items-end gap-1">{isPenthouse(u,typ)?<span className="rounded-full bg-[#9a3b2f] px-2 py-0.5 text-[10px] font-semibold tracking-[0.16em] text-white">HOT</span>:null}<span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[0.12em] uppercase ${statusTone(u.status)}`}>{translate(u.status)}</span></span></div><div className="mt-3 flex flex-wrap gap-2 text-xs text-[#756044]"><span className="inline-flex items-center gap-1.5 rounded-full bg-[#f7f3ee] px-2.5 py-1"><MapPin size={13} className="text-[#8e7654]"/>{local?shopFloorLabel(u.floor||'',t):(u.floor||'—')}</span><span className="inline-flex items-center gap-1.5 rounded-full bg-[#f7f3ee] px-2.5 py-1"><Ruler size={13} className="text-[#8e7654]"/>{u.area_total_m2!=null?`${formatArea(u.area_total_m2)} m²`:'—'}</span>{!local?<span className="inline-flex items-center gap-1.5 rounded-full bg-[#f7f3ee] px-2.5 py-1"><BedDouble size={13} className="text-[#8e7654]"/>{u.bedrooms ?? '—'} {t('dorm.','bedrooms')}</span>:null}</div><div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={()=>{onPick(u);close()}} className="inline-flex min-h-10 items-center justify-center rounded-full bg-[#29251e] px-3 text-xs text-[#f7f3ee]">{t('Abrir ficha','Open details')}</button><button type="button" onClick={()=>{if(local||typ?.panorama||typ?.rooms.some(r=>r.url||r.scenes.length)){onTour(u);close()}else setNotice(t(`La unidad ${u.unit_number} todavía no tiene recorrido 360° disponible.`,`Unit ${u.unit_number} has no available 360° tour.`))}} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full border border-[#bda27e]/70 bg-[#f7f3ee] px-3 text-xs text-[#29251e]">{local?<Images size={14}/>:<Scan size={14}/>}{local?t('Galería','Gallery'):'360°'}</button></div><div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={()=>setShare(u)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[#bda27e] bg-white px-3 text-[11px] font-semibold tracking-[0.14em] text-[#29251e]"><QrCode size={14} className="text-[#8e7654]"/>QR</button>{model?<a href={model} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-2 text-xs text-[#756044]"><Box size={14} className="text-[#8e7654]"/>{t('Modelo 3D','3D model')}</a>:null}</div></li>})}</ul></section>)}</div>
     {!filtered.length?<p className="py-4 text-sm">{t('No hay unidades que coincidan con estos filtros.','No units match these filters.')}</p>:null}
    </section>:null}
    {section==='home'?<button type="button" className="rounded border border-[#bda27e] p-3" onClick={()=>{onHome();close()}}>{t('Ver edificio y pisos','View building and floors')}</button>:null}
    {section==='progress'?<section className="space-y-4"><div><p className="text-[10px] tracking-[0.22em] text-[#8e7654] uppercase">{t('Obra','Site')}</p><h2 className="font-serif text-3xl text-[#29251e]">{t('Avance de obra','Construction progress')}</h2></div>{constructionProgress.length?constructionProgress.map(update=><article key={update.id} className="overflow-hidden rounded-2xl border border-[#bda27e]/35 bg-white/80"><div className="p-4"><time dateTime={update.date} className="text-[10px] tracking-[0.16em] text-[#8e7654] uppercase">{update.date}</time><h3 className="mt-1 font-serif text-xl">{translate(update.title)}</h3><p className="mt-2 text-sm leading-relaxed text-[#756044]">{translate(update.description)}</p></div>{update.media.map(media=><figure key={media.url}>{media.type==='image'?<img src={media.url} alt={media.caption} className="w-full"/>:<video src={media.url} controls preload="metadata" className="w-full"/>}<figcaption className="px-4 py-2 text-xs text-[#756044]">{translate(media.caption)}</figcaption></figure>)}</article>):<div className="rounded-2xl border border-[#bda27e]/35 bg-white/80 px-5 py-8 text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#ded3c1] text-[#29251e]"><HardHat size={22} strokeWidth={1.5}/></span><p className="mt-4 font-serif text-2xl text-[#29251e]">{t('Registro en preparación','Log in preparation')}</p><p className="mx-auto mt-2 max-w-[18rem] text-sm leading-relaxed text-[#756044]">{t('Cuando haya fotos con fecha, se publican en esta misma vista.','Dated site photos are published in this same view.')}</p></div>}<a href={`mailto:${SITE.email}`} className="flex items-center gap-3 rounded-2xl border border-[#bda27e]/35 bg-white/80 p-3 transition-colors hover:bg-white"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#ded3c1] text-[#29251e]"><Mail size={18} strokeWidth={1.5}/></span><span className="min-w-0"><span className="block text-[10px] tracking-[0.16em] text-[#8e7654] uppercase">{t('Pedir el avance','Ask for an update')}</span><span className="block truncate text-sm">{SITE.email}</span></span></a></section>:null}
    {selected&&!share?<button type="button" onClick={()=>setShare(selected)} className="mt-6 inline-flex min-h-9 items-center gap-1.5 self-start rounded-full border border-[#bda27e] bg-white px-3 text-[11px] font-semibold tracking-[0.14em] text-[#29251e]"><QrCode size={14} className="text-[#8e7654]"/>QR</button>:null}
    {share?<section className="mt-5 rounded-2xl border border-[#bda27e]/50 bg-white p-4 text-center"><p className="text-[11px] font-semibold tracking-[0.16em] text-[#8e7654] uppercase">{t('Compartir unidad','Share unit')} {share.unit_number}</p>{qr?<img src={qr} width={180} height={180} alt={`QR ${share.unit_number}`} className="mx-auto my-3 rounded-xl bg-white"/>:null}<a href={shareUrl} target="_blank" rel="noopener noreferrer" className="break-all text-xs underline">{shareUrl}</a><p className="mt-2 text-xs text-[#756044]">{t('El QR abre el recorrido público de esta unidad.','The QR opens the public tour for this unit.')}</p></section>:null}
    </div>:null}
    <footer className="mt-auto border-t border-[#bda27e]/30 pt-4"><label className="flex items-center justify-between gap-3 text-xs text-[#756044]">{t('Idioma','Language')}<MenuSelect label="Idioma / Language" value={lang} options={languageOptions} placement="above" align="end" onChange={value=>setLang(value as TourLocale)}/></label>{lang==='en'?<p className="mt-2 text-[11px] leading-relaxed text-[#756044]">Original plans, images, videos and published descriptions without an English version remain in their original language.</p>:null}<div className="mt-3 grid gap-2"><a href="/inicio" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-[#bda27e]/50 bg-white/70 px-3 text-xs text-[#29251e] transition-colors hover:bg-white"><ArrowLeft size={14}/>{t('Volver a la web','Back to website')}</a></div></footer>
    {notice?<p role="status" className="mt-3 text-sm">{notice}</p>:null}
   </aside></FocusScope>
  </div>:null}
 </>
}
