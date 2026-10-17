'use client'

import { useState } from 'react'
import type { WorkflowExecutionStep } from './executionWorkflow'
import { writerContextSlices } from './writerContext'
import styles from './MessageTraceView.module.css'

function RecordedJson({ title, data }: { title: string; data: unknown }) {
  const content = JSON.stringify(data, null, 2), [copied, setCopied] = useState(''), [manual, setManual] = useState('')
  return <details className={styles.technical}>
    <summary>{title}</summary>
    <button type="button" className={styles.button} onClick={async () => {
      try { await navigator.clipboard.writeText(content); setCopied(content); setManual('') }
      catch { setManual(content); setCopied('') }
    }}>Copiar {title}</button>
    <span role="status">{copied === content ? ' JSON copiado.' : ''}</span>
    {manual === content && <label>Seleccione el JSON para copiarlo.<textarea readOnly aria-label={title + ' para copiar'} value={content} onFocus={event => event.currentTarget.select()} /></label>}
    <pre aria-label={title}>{content}</pre>
  </details>
}

export function WriterContextPanel({ step }: { step: WorkflowExecutionStep }) {
  const capture = writerContextSlices(step)
  if (!capture) return null
  return <section className={styles.writerContext} aria-label="Contexto exacto del redactor">
    <h5>Siguiente paso y ficha recibidos por el redactor</h5>
    <p>Valores de esta llamada, conservando las claves del JSON original. El plan fue preparado por el sistema a partir de la interpretación de la IA; la redacción corresponde al redactor.</p>
    {(capture.limited || capture.protected) && <p className={styles.notice}>La captura indica contenido abreviado o protegido. No se reconstruyen los valores originales.</p>}
    <RecordedJson title="JSON del siguiente paso y reglas" data={capture.decision} />
    <RecordedJson title="JSON de la ficha y memoria del lead" data={capture.profile} />
    <RecordedJson title="JSON completo de los datos enviados" data={capture.input} />
  </section>
}
