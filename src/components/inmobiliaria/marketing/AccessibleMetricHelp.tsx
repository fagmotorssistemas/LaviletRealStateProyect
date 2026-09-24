'use client'
import { useEffect, useRef, useState } from 'react'
import { Dialog, Modal, ModalOverlay } from 'react-aria-components'

// Separate implementation: preserve the colleague's MetricHelp.tsx unchanged.
export function MetricHelp({label,description}:{label:string;description:string}) {
  const [open,setOpen]=useState(false)
  const trigger=useRef<HTMLButtonElement>(null)
  const hoverTimer=useRef<ReturnType<typeof setTimeout>|null>(null)
  const suppressHoverUntil=useRef(0)
  const cancelHover=()=>{if(hoverTimer.current)clearTimeout(hoverTimer.current)}
  const close=()=>{cancelHover();suppressHoverUntil.current=Date.now()+1000;setOpen(false);trigger.current?.focus()}
  useEffect(()=>()=>{if(hoverTimer.current)clearTimeout(hoverTimer.current)},[])
  return <>
    <button ref={trigger} type="button" aria-label={`Explicación: ${label}`} aria-haspopup="dialog" aria-expanded={open}
      onMouseEnter={()=>{cancelHover();if(Date.now()<suppressHoverUntil.current)return;hoverTimer.current=setTimeout(()=>{if(!document.querySelector('[role="dialog"]'))setOpen(true)},300)}} onMouseLeave={cancelHover} onClick={()=>{cancelHover();setOpen(true)}}
      className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-stone-300 text-xs normal-case tracking-normal focus-visible:outline-2">?</button>
    <ModalOverlay isOpen={open} onOpenChange={value=>value?setOpen(true):close()} isDismissable
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/20 p-4">
      <Modal className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"><Dialog aria-label={`Explicación: ${label}`}>
        <h3 className="font-semibold">{label}</h3><p className="mt-2 text-sm leading-relaxed">{description}</p>
        <button type="button" onClick={close} className="mt-4 rounded border px-3 py-2" aria-label="Cerrar explicación">Cerrar</button>
      </Dialog></Modal>
    </ModalOverlay>
  </>
}
