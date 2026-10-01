'use client'
/* eslint-disable @next/next/no-img-element -- QR is generated locally as a data URL. */
import { useEffect, useRef, useState } from 'react'
import { useTourLanguage } from '@/lib/tour/tourLocale'
import { Menu, X, Maximize, Minimize, ArrowLeft, Home, Building2, Search, Store, Scan, Trees, HardHat, MapPin, ChevronRight, Mail, Ruler, BedDouble, Images, QrCode, Box, Cookie } from 'lucide-react'
import { FocusScope } from 'react-aria'
import QRCode from 'qrcode'
import type { TourPublicCatalog, TourUnitSummary } from '@/types/tour'
import { UNIT_MODEL_ORIGIN, unitModelUrl } from '@/lib/tour/unitModels'
import { COOKIE_BANNER_ENABLED, openCookiePreferences } from '@/lib/tour/consent'
import { SITE } from '@/lib/marketing/site'
import { constructionProgress } from '@/lib/tour/constructionProgress'
import { emptyUnitFilters, filterShowroomUnits, publicShowroomUrl } from '@/lib/tour/showroomMenu'
import { parseFloorNumber } from '@/lib/tour/floorPlanHotspots'
type Section='home'|'areas'|'units'|'shops'|'tour'|'amenities'|'progress'|'contact'
const names={es:['Inicio / edificio','Áreas del proyecto','Buscar departamentos','Locales comerciales','Departamento modelo / 360°','Amenidades','Avance de obra','Ubicación y contacto'],en:['Home / building','Project areas','Find an apartment','Commercial units','Model apartment / 360°','Amenities','Construction progress','Location and contact']}
const icons=[Home,Building2,Search,Store,Scan,Trees,HardHat,MapPin]
const sections:Section[]=['home','areas','units','shops','tour','amenities','progress','contact']
function shopFloorLabel(floor: string, label: (es: string, en: string) => string) {
  const text = floor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (text.includes('baja')) return label('Planta baja', 'Ground floor')
  if (text.includes('alta')) return label('Planta alta', 'Upper floor')
  return floor
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
function WhatsAppIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M20.52 3.48A11.8 11.8 0 0 0 12.06 0C5.5 0 .16 5.33.16 11.89c0 2.1.55 4.14 1.59 5.95L0 24l6.3-1.65a11.9 11.9 0 0 0 5.76 1.47h.01c6.56 0 11.9-5.34 11.9-11.9 0-3.18-1.24-6.16-3.45-8.44zM12.07 21.3h-.01a9.4 9.4 0 0 1-4.79-1.31l-.34-.2-3.74.98 1-3.64-.22-.37a9.36 9.36 0 0 1-1.44-5 9.42 9.42 0 0 1 16.1-6.66 9.35 9.35 0 0 1 2.75 6.66c0 5.2-4.23 9.54-9.31 9.54zm5.16-7.05c-.28-.14-1.67-.82-1.93-.92-.26-.1-.45-.14-.64.14-.19.28-.73.92-.9 1.1-.16.19-.33.21-.61.07-.28-.14-1.18-.43-2.25-1.38-.83-.74-1.39-1.65-1.55-1.93-.16-.28-.02-.43.12-.57.13-.13.28-.33.42-.5.14-.16.19-.28.28-.47.09-.19.05-.35-.02-.5-.07-.14-.64-1.54-.88-2.11-.23-.55-.47-.48-.64-.49h-.55c-.19 0-.5.07-.76.35-.26.28-1 1-1 2.43s1.02 2.82 1.17 3.01c.14.19 2.01 3.07 4.88 4.3.68.3 1.21.47 1.63.6.68.22 1.3.19 1.79.11.55-.08 1.67-.68 1.9-1.34.24-.66.24-1.22.17-1.34-.07-.12-.26-.19-.54-.33z" />
    </svg>
  )
}
function statusTone(status: string) {
  const key = status.toLowerCase()
  if (key.includes('dispon')) return 'bg-[#e5f2e6] text-[#246b32]'
  if (key.includes('reserv')) return 'bg-[#f4ead7] text-[#8a6230]'
  if (key.includes('vend')) return 'bg-[#ece7e1] text-[#6d645b]'
  return 'bg-[#efe8dc] text-[#756044]'
}
export function ShowroomMenu({units,catalog,selected,onHome,onPick,onTour,onAmenities,onClosePanels,root}:{units:TourUnitSummary[];catalog:TourPublicCatalog|null;selected:TourUnitSummary|null;onHome:(view?:'image'|'plan')=>void;onPick:(u:TourUnitSummary)=>void;onTour:(u:TourUnitSummary)=>void;onAmenities:()=>void;onClosePanels:()=>void;root:React.RefObject<HTMLDivElement|null>}){
 const [content,setContent]=useState(false)
 const [open,setOpen]=useState(false),[section,setSection]=useState<Section>('home')
 const {locale:lang,setLocale:setLang,t:translate}=useTourLanguage()
 const [filters,setFilters]=useState(emptyUnitFilters),[full,setFull]=useState(false),[notice,setNotice]=useState(''),[share,commitShare]=useState<TourUnitSummary|null>(null),[qr,setQr]=useState('')
 const shareUrl=share?publicShowroomUrl(share.unit_number,UNIT_MODEL_ORIGIN)+(lang==='en'?'&lang=en':''):''
 const setShare=(unit:TourUnitSummary|null)=>{setQr('');commitShare(unit)}
 const button=useRef<HTMLButtonElement>(null)
 const t=(es:string,en:string)=>lang==='es'?es:en
 useEffect(()=>{const sync=()=>setFull(!!document.fullscreenElement);document.addEventListener('fullscreenchange',sync);return()=>document.removeEventListener('fullscreenchange',sync)},[])
 useEffect(()=>{if(!open)return;const close=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);button.current?.focus()}};document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close)},[open])
 useEffect(()=>{if(!share)return;let active=true;const url=publicShowroomUrl(share.unit_number,UNIT_MODEL_ORIGIN)+(lang==='en'?'&lang=en':'');void QRCode.toDataURL(url,{width:224,margin:4,errorCorrectionLevel:'M'}).then(value=>{if(active)setQr(value)}).catch(()=>{if(active)setNotice('No se pudo generar el QR; use el enlace.')});return()=>{active=false}},[share,lang])
 const choices=(key:'floor'|'category'|'status'|'bedrooms')=>[...new Set(units.map(u=>u[key]).filter(v=>v!=null && v!==''))].sort((a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true}))
 const shopFloors=[...new Set(units.filter(u=>u.category==='local').map(u=>u.floor).filter((floor):floor is string=>Boolean(floor)))].sort((a,b)=>shopFloorRank(a)-shopFloorRank(b)||a.localeCompare(b,'es'))
 const optionValues=(key:'floor'|'category'|'status'|'bedrooms')=>{
  if(key==='floor'&&section==='shops')return shopFloors
  const values=choices(key).map(value=>String(value))
  if(key!=='floor')return values
  return values.sort((a,b)=>floorRank(a)-floorRank(b)||a.localeCompare(b,'es'))
 }
 const filtered=filterShowroomUnits(units,filters,section==='shops')
 const close=()=>{setOpen(false);button.current?.focus()}
 const go=(next:Section)=>{setShare(null);setNotice('');if(next==='amenities'){onAmenities();close();return}setContent(true);setSection(next);if(next==='units'||next==='shops'||next==='tour')setFilters(emptyUnitFilters);if(next==='home'){onHome();close()}else onClosePanels()}
 async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else if(root.current?.requestFullscreen)await root.current.requestFullscreen();else setNotice(t('Este navegador no permite pantalla completa.','Fullscreen is unavailable in this browser.'))}catch{setNotice(t('No se pudo cambiar a pantalla completa.','Fullscreen could not be changed.'))}}
 const fields=[['floor',t('Piso','Floor')],['bedrooms',t('Dormitorios','Bedrooms')],['category',t('Tipo','Type')],['status',t('Disponibilidad','Availability')]] as const
 return <>
  <header aria-label="Controles del showroom" className="absolute inset-x-0 top-0 z-[90] flex h-[calc(4rem+env(safe-area-inset-top))] items-center gap-2 bg-transparent px-3 pt-[env(safe-area-inset-top)] text-[#f7f3ee] [text-shadow:0_1px_3px_rgba(20,17,14,0.85)] sm:px-5">
   <button ref={button} type="button" aria-label={t('Abrir menú del showroom','Open showroom menu')} aria-expanded={open} onClick={()=>{onClosePanels();setContent(false);setShare(null);setNotice('');setOpen(true)}} className="rounded-full border border-[#bda27e]/50 bg-[#29251e]/90 p-3 text-[#f7f3ee]"><Menu size={20}/></button>
   <button type="button" aria-label={full?t('Salir de pantalla completa','Exit fullscreen'):t('Pantalla completa','Fullscreen')} onClick={()=>void fullscreen()} className="rounded-full border border-[#bda27e]/50 bg-[#29251e]/90 p-3 text-[#f7f3ee]">{full?<Minimize size={20}/>:<Maximize size={20}/>}</button>
   <span className="ml-2 min-w-0 truncate font-serif text-sm tracking-[.22em] sm:text-lg">LA VILET</span>
   <a href="/inicio" aria-label={t('Volver a la página web','Back to website')} title={t('Volver a la página web','Back to website')} className="ml-auto inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-[#bda27e]/50 bg-[#29251e]/90 px-3 text-xs text-[#f7f3ee] [text-shadow:none] transition-colors hover:bg-[#3a342b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#bda27e]">
    <ArrowLeft size={16} aria-hidden="true"/><span className="sm:hidden">{t('Volver','Back')}</span><span className="hidden sm:inline">{t('Volver a la web','Back to website')}</span>
   </a>
  </header>
  {!open && notice?<p role="status" className="absolute left-3 top-20 z-[90] rounded bg-[#f7f3ee] p-2 text-xs text-[#29251e]">{notice}</p>:null}
  {open?<div className="absolute inset-0 z-[200] flex bg-black/30 p-2 sm:p-3" onClick={close}>
   <FocusScope contain restoreFocus autoFocus><aside role="dialog" aria-modal="true" aria-label={t('Menú La Vilet','La Vilet menu')} lang={lang} onClick={e=>e.stopPropagation()} className={`flex h-full w-full flex-col overflow-y-auto rounded-2xl bg-[#f7f3ee] p-5 text-[#29251e] shadow-2xl ${!content?'max-w-[320px]':'max-w-md'}`}>
    <header className="flex items-center justify-between border-b border-[#bda27e]/40 pb-4"><div><p className="font-serif text-3xl tracking-[.16em]">LA VILET</p><p className="mt-2 text-xs">{SITE.city}</p></div><button type="button" aria-label={t('Cerrar menú','Close menu')} onClick={close} className="rounded-full border border-[#bda27e]/50 p-2"><X/></button></header>
    {!content?<nav aria-label={t('Secciones','Sections')} className="my-6 flex flex-1 flex-col gap-1">{sections.map((key,i)=>{const Icon=icons[i];return <button type="button" key={key} aria-current={section===key?'page':undefined} onClick={()=>go(key)} className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-[#8e7654] ${section===key?'bg-[#ded3c1]':'hover:bg-[#eae3d8]'}`}><Icon size={18} strokeWidth={1.5} className="shrink-0 text-[#8e7654]"/><span className="flex-1">{names[lang][i]}</span><ChevronRight size={14} className="shrink-0 text-[#8e7654]"/></button>})}</nav>:<button type="button" onClick={()=>{setContent(false);setShare(null);setNotice('')}} className="my-4 flex min-h-11 items-center gap-2 self-start text-sm text-[#756044]"><ArrowLeft size={18}/>{t('Volver al menú','Back to menu')}</button>}
    {content?<div className="flex-1">
    {(section==='units'||section==='shops'||section==='tour')?<section>
     <h2 className="mb-3 font-serif text-2xl">{names[lang][sections.indexOf(section)]}</h2>
     {section!=='tour'?<div className="mb-4 grid grid-cols-2 gap-2">
      {fields.filter(([key])=>section!=='shops'||(key!=='bedrooms'&&key!=='category')).map(([key,label])=><label key={key} className="text-xs">{label}<select aria-label={label} value={filters[key]} onChange={e=>setFilters({...filters,[key]:e.target.value})} className="mt-1 w-full rounded border border-[#bda27e]/50 bg-white p-2"><option value="">{t('Todos','All')}</option>{optionValues(key).map(value=><option key={value} value={value}>{key==='floor'&&section==='shops'?shopFloorLabel(value,t):translate(value)}</option>)}</select></label>)}
      <button type="button" onClick={()=>setFilters(emptyUnitFilters)} className="col-span-2 text-left text-xs underline">{t('Limpiar filtros','Clear filters')}</button>
     </div>:<p className="mb-3 text-sm">{t('Elija una unidad. Los recursos de tipología se muestran como referencia, no como una vista exterior exclusiva.','Choose a unit. Typology resources are references, not a verified exterior view from that unit.')}</p>}
     <p className="mb-3 text-[11px] tracking-[0.16em] text-[#8e7654] uppercase">{filtered.length} {section==='shops'?t('locales','units'):t('unidades','units')}</p>
     <ul className="flex flex-col gap-3">{filtered.map(u=>{const typ=catalog?.typologies.find(v=>(u.unit_type_id&&v.id===u.unit_type_id)||(u.typology_code&&v.code===u.typology_code));const local=u.category==='local'||typ?.category==='local';const model=unitModelUrl({...u});return <li key={u.id} className="rounded-2xl border border-[#bda27e]/35 bg-white/80 p-4 shadow-[0_10px_30px_rgba(41,37,30,0.06)]"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] tracking-[0.22em] text-[#8e7654] uppercase">{local?t('Local comercial','Commercial unit'):isPenthouse(u,typ)?'Penthouse':t('Departamento','Apartment')}</p><p className="font-serif text-[1.65rem] leading-none tracking-wide text-[#29251e]">{u.unit_number}</p></div><span className="flex shrink-0 flex-col items-end gap-1">{isPenthouse(u,typ)?<span className="rounded-full bg-[#9a3b2f] px-2 py-0.5 text-[10px] font-semibold tracking-[0.16em] text-white">HOT</span>:null}<span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[0.12em] uppercase ${statusTone(u.status)}`}>{translate(u.status)}</span></span></div><div className="mt-3 flex flex-wrap gap-2 text-xs text-[#756044]"><span className="inline-flex items-center gap-1.5 rounded-full bg-[#f7f3ee] px-2.5 py-1"><MapPin size={13} className="text-[#8e7654]"/>{local?shopFloorLabel(u.floor||'',t):(u.floor||'—')}</span><span className="inline-flex items-center gap-1.5 rounded-full bg-[#f7f3ee] px-2.5 py-1"><Ruler size={13} className="text-[#8e7654]"/>{u.area_total_m2!=null?`${formatArea(u.area_total_m2)} m²`:'—'}</span>{!local?<span className="inline-flex items-center gap-1.5 rounded-full bg-[#f7f3ee] px-2.5 py-1"><BedDouble size={13} className="text-[#8e7654]"/>{u.bedrooms ?? '—'} {t('dorm.','bedrooms')}</span>:null}</div><div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={()=>{onPick(u);close()}} className="inline-flex min-h-10 items-center justify-center rounded-full bg-[#29251e] px-3 text-xs text-[#f7f3ee]">{t('Abrir ficha','Open details')}</button><button type="button" onClick={()=>{if(local||typ?.panorama||typ?.rooms.some(r=>r.url||r.scenes.length)){onTour(u);close()}else setNotice(t(`La unidad ${u.unit_number} todavía no tiene recorrido 360° disponible.`,`Unit ${u.unit_number} has no available 360° tour.`))}} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full border border-[#bda27e]/70 bg-[#f7f3ee] px-3 text-xs text-[#29251e]">{local?<Images size={14}/>:<Scan size={14}/>}{local?t('Galería','Gallery'):'360°'}</button></div><div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={()=>setShare(u)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-2 text-xs text-[#756044]"><QrCode size={14} className="text-[#8e7654]"/>QR</button>{model?<a href={model} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-2 text-xs text-[#756044]"><Box size={14} className="text-[#8e7654]"/>{t('Modelo 3D','3D model')}</a>:null}</div></li>})}</ul>
     {!filtered.length?<p className="py-4 text-sm">{t('No hay unidades que coincidan con estos filtros.','No units match these filters.')}</p>:null}
    </section>:null}
    {section==='home'?<button type="button" className="rounded border border-[#bda27e] p-3" onClick={()=>{onHome();close()}}>{t('Ver edificio y pisos','View building and floors')}</button>:null}
    {section==='areas'?<section className="space-y-4"><div><p className="text-[10px] tracking-[0.22em] text-[#8e7654] uppercase">{t('Edificio','Building')}</p><h2 className="font-serif text-3xl text-[#29251e]">{t('Distribución del proyecto','Project layout')}</h2></div><p className="text-sm leading-relaxed text-[#756044]">{t('Recorra los pisos y vea dónde está cada vivienda y cada local. Las áreas compartidas están en Amenidades.','Walk the floors and see where each home and commercial unit sits. Shared areas are under Amenities.')}</p><button type="button" onClick={()=>{onHome('plan');close()}} className="flex w-full items-center gap-3 rounded-2xl border border-[#bda27e]/35 bg-white/80 p-3 text-left transition-colors hover:bg-white"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#29251e] text-[#f7f3ee]"><Building2 size={18} strokeWidth={1.5}/></span><span className="min-w-0 flex-1"><span className="block text-[10px] tracking-[0.16em] text-[#8e7654] uppercase">{t('Plano','Plan')}</span><span className="block text-sm font-medium">{t('Abrir plano del edificio','Open building plan')}</span></span><ChevronRight size={16} className="shrink-0 text-[#8e7654]"/></button></section>:null}
    {section==='progress'?<section className="space-y-4"><div><p className="text-[10px] tracking-[0.22em] text-[#8e7654] uppercase">{t('Obra','Site')}</p><h2 className="font-serif text-3xl text-[#29251e]">{t('Avance de obra','Construction progress')}</h2></div>{constructionProgress.length?constructionProgress.map(update=><article key={update.id} className="overflow-hidden rounded-2xl border border-[#bda27e]/35 bg-white/80"><div className="p-4"><time dateTime={update.date} className="text-[10px] tracking-[0.16em] text-[#8e7654] uppercase">{update.date}</time><h3 className="mt-1 font-serif text-xl">{translate(update.title)}</h3><p className="mt-2 text-sm leading-relaxed text-[#756044]">{translate(update.description)}</p></div>{update.media.map(media=><figure key={media.url}>{media.type==='image'?<img src={media.url} alt={media.caption} className="w-full"/>:<video src={media.url} controls preload="metadata" className="w-full"/>}<figcaption className="px-4 py-2 text-xs text-[#756044]">{translate(media.caption)}</figcaption></figure>)}</article>):<div className="rounded-2xl border border-[#bda27e]/35 bg-white/80 px-5 py-8 text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#ded3c1] text-[#29251e]"><HardHat size={22} strokeWidth={1.5}/></span><p className="mt-4 font-serif text-2xl text-[#29251e]">{t('Registro en preparación','Log in preparation')}</p><p className="mx-auto mt-2 max-w-[18rem] text-sm leading-relaxed text-[#756044]">{t('Cuando haya fotos con fecha, se publican en esta misma vista.','Dated site photos are published in this same view.')}</p></div>}<a href={`mailto:${SITE.email}`} className="flex items-center gap-3 rounded-2xl border border-[#bda27e]/35 bg-white/80 p-3 transition-colors hover:bg-white"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#ded3c1] text-[#29251e]"><Mail size={18} strokeWidth={1.5}/></span><span className="min-w-0"><span className="block text-[10px] tracking-[0.16em] text-[#8e7654] uppercase">{t('Pedir el avance','Ask for an update')}</span><span className="block truncate text-sm">{SITE.email}</span></span></a></section>:null}
    {section==='contact'?<section className="space-y-4"><div><p className="text-[10px] tracking-[0.22em] text-[#8e7654] uppercase">{t('Visítanos','Visit us')}</p><h2 className="font-serif text-3xl text-[#29251e]">{t('Ubicación y contacto','Location and contact')}</h2></div><div className="overflow-hidden rounded-2xl border border-[#bda27e]/40 shadow-[0_10px_30px_rgba(41,37,30,0.06)]"><iframe title={t('Mapa de La Vilet','La Vilet map')} src={SITE.location.embedUrl} className="h-44 w-full" loading="lazy" referrerPolicy="no-referrer-when-downgrade"/></div><div className="flex flex-col gap-2"><a href={SITE.location.mapsUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-2xl border border-[#bda27e]/35 bg-white/80 p-3 transition-colors hover:bg-white"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#ded3c1] text-[#29251e]"><MapPin size={18} strokeWidth={1.5}/></span><span className="min-w-0"><span className="block text-[10px] tracking-[0.16em] text-[#8e7654] uppercase">{t('Dirección','Address')}</span><span className="block text-sm">{SITE.location.address}</span></span></a><a href={`mailto:${SITE.email}`} className="flex items-center gap-3 rounded-2xl border border-[#bda27e]/35 bg-white/80 p-3 transition-colors hover:bg-white"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#ded3c1] text-[#29251e]"><Mail size={18} strokeWidth={1.5}/></span><span className="min-w-0"><span className="block text-[10px] tracking-[0.16em] text-[#8e7654] uppercase">{t('Correo','Email')}</span><span className="block truncate text-sm">{SITE.email}</span></span></a>{SITE.whatsapp?<a href={`https://wa.me/${SITE.whatsapp}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-2xl border border-[#bda27e]/35 bg-white/80 p-3 transition-colors hover:bg-white"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#25D366] text-white"><WhatsAppIcon size={18}/></span><span className="min-w-0"><span className="block text-[10px] tracking-[0.16em] text-[#8e7654] uppercase">WhatsApp</span><span className="block text-sm">{t('Escribir al equipo','Message the team')}</span></span></a>:null}</div></section>:null}
    {selected&&!share?<button type="button" onClick={()=>setShare(selected)} className="mt-6 self-start underline">{t('Compartir unidad','Share unit')} {selected.unit_number} · QR</button>:null}
    {share?<section className="mt-5 border-t border-[#bda27e]/40 pt-4"><h3>{t('Compartir unidad','Share unit')} {share.unit_number}</h3>{qr?<img src={qr} width={224} height={224} alt={`QR ${share.unit_number}`} className="my-2 max-w-full"/>:null}<a href={shareUrl} target="_blank" rel="noopener noreferrer" className="break-all text-xs underline">{shareUrl}</a><p className="mt-2 text-xs">{t('El QR abre el recorrido público de esta unidad.','The QR opens the public tour for this unit.')}</p></section>:null}
    </div>:null}
    <footer className="mt-auto border-t border-[#bda27e]/30 pt-4"><label className="flex items-center justify-between gap-3 text-xs text-[#756044]">{t('Idioma','Language')}<select aria-label="Idioma / Language" value={lang} onChange={e=>setLang(e.target.value as 'es'|'en')} className="rounded-full border border-[#bda27e]/60 bg-white px-3 py-1.5 text-sm text-[#29251e]"><option value="es">Español</option><option value="en">English</option></select></label>{lang==='en'?<p className="mt-2 text-[11px] leading-relaxed text-[#756044]">Original plans, images, videos and published descriptions without an English version remain in their original language.</p>:null}<div className="mt-3 grid gap-2"><a href="/inicio" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-[#bda27e]/50 bg-white/70 px-3 text-xs text-[#29251e] transition-colors hover:bg-white"><ArrowLeft size={14}/>{t('Volver a la web','Back to website')}</a>{COOKIE_BANNER_ENABLED?<button type="button" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-3 text-xs text-[#756044] transition-colors hover:bg-white/70" onClick={()=>{close();openCookiePreferences()}}><Cookie size={14}/>{t('Preferencias de cookies','Cookie preferences')}</button>:null}</div></footer>
    {notice?<p role="status" className="mt-3 text-sm">{notice}</p>:null}
   </aside></FocusScope>
  </div>:null}
 </>
}
