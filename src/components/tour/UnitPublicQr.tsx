'use client'

import { useTourLanguage } from '@/lib/tour/tourLocale'
/* eslint-disable @next/next/no-img-element -- QR is generated locally as a data URL. */
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { unitTourUrl } from '@/lib/tour/unitModels'
export function UnitPublicQr({number}:{number:string}){
  const { t, locale } = useTourLanguage()

 const [open,setOpen]=useState(false),[image,setImage]=useState('')
 const url=unitTourUrl(number)+(locale==='en'?'&lang=en':'')
 useEffect(()=>{if(!open)return;let active=true;void QRCode.toDataURL(url,{width:208,margin:4}).then(data=>{if(active)setImage(data)}).catch(()=>{if(active)setImage('')});return()=>{active=false}},[open,url])
 return <div className="p-2 text-xs text-[#2b1a18]"><button type="button" onClick={()=>setOpen(!open)} aria-expanded={open} className="underline">{t(open?'Cerrar QR':'Compartir recorrido · QR')}</button>{open?<div>{image?<img src={image} alt={t(`QR público de la unidad ${number}`)} width={208} height={208}/>:null}<a href={url} target="_blank" rel="noopener noreferrer" className="break-all underline">{t("Abrir enlace público de la unidad ")}{t(number)}</a></div>:null}</div>
}
