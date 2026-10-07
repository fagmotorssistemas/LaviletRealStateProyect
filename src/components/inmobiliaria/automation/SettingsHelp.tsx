'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './SettingsHelp.module.css'
import { automationHelpFor, fieldHelpFor } from '@/lib/inmobiliaria/automationHelp'

export type SettingsHelpContent = {
  title: string; configures: string; usedByBot: string; applies: string; saving: string; example?: string
}
/** Click, touch and keyboard use the same help; native dialog manages focus and Escape. */
export function SettingsHelp({ title, configures, usedByBot, applies, saving, example }: SettingsHelpContent) {
  const [open, setOpen] = useState(false)
  const id = useId(), dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLSpanElement>(null)
  useEffect(() => { if (open && dialog.current && !dialog.current.open) dialog.current.showModal() }, [open])
  const close = () => { dialog.current?.close(); setOpen(false); trigger.current?.focus() }
  return <>
    <span ref={trigger} role="button" tabIndex={0} className={styles.trigger} aria-label={`Ayuda: ${title}`} aria-haspopup="dialog" aria-expanded={open}
      onClick={event => { event.preventDefault(); event.stopPropagation(); setOpen(true) }}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); setOpen(true) } }}><span aria-hidden="true">!</span></span>
    {open && createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
      onCancel={event => { event.preventDefault(); close() }} onClose={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) close() }}>
      <div className={styles.heading}><h2 id={`${id}-title`}>{title}</h2><button type="button" onClick={close} aria-label="Cerrar ayuda">×</button></div>
      <div id={`${id}-description`} className={styles.content}>
        <p><strong>Qué configura</strong>{configures}</p><p><strong>Cómo lo utiliza el bot</strong>{usedByBot}</p>
        <p><strong>Cuándo aplica</strong>{applies}</p><p><strong>Guardar o publicar</strong>{saving}</p>
        {example && <p className={styles.example}><strong>Ejemplo</strong>{example}</p>}
      </div>
    </dialog>, document.body)}
  </>
}

export function SettingsFieldHelp({ title, section }: { title: string; section: string }) {
  const content = automationHelpFor(section)
  return <SettingsHelp title={title} {...content} configures={fieldHelpFor(title, section)} />
}
