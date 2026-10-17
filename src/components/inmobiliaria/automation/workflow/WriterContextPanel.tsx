'use client'

import { useState } from 'react'
import type { WorkflowExecutionStep } from './executionWorkflow'
import { writerContextSlices, recordedWriterObjective } from './writerContext'
import styles from './MessageTraceView.module.css'

function RecordedJson({ title, data, expanded = false }: { title: string; data: unknown; expanded?: boolean }) {
  const content = JSON.stringify(data, null, 2), [copied, setCopied] = useState(''), [manual, setManual] = useState('')
  return <details className={styles.technical} open={expanded || undefined}>
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

export function WriterDecisionOverview({ steps, onStep }: { steps: WorkflowExecutionStep[]; onStep: (order: number) => void }) {
  const writers = steps.filter(step => step.key === 'model_request' && (step.input.ai_role === 'writer' || step.input.task === 'writing'))
  const final = writers.at(-1), objective = final ? recordedWriterObjective(final) : null
  if (!final) return <section className={styles.writerDecision} aria-label="Plan enviado al redactor">
    <h4>Plan enviado al redactor</h4><p>Esta ejecución no registra una llamada al redactor. No hay un JSON de redacción que mostrar.</p>
  </section>
  return <section className={styles.writerDecision} aria-label="Plan enviado al redactor">
    <h4>Plan enviado al redactor · paso {final.order}</h4>
    <p><code>contrato_redaccion.objetivo_siguiente</code> · Objeto registrado en la última llamada al redactor{writers.length > 1 ? ` de ${writers.length} llamadas conservadas` : ''}.</p>
    {!objective ? <p>No se conservó este objeto en la captura. Puede abrir el paso para revisar la entrada disponible.</p>
      : <>{(objective.limited || objective.protected) && <p className={styles.notice}>La captura contiene datos abreviados o protegidos.</p>}
        <RecordedJson title="JSON destacado del siguiente paso" data={objective.value} expanded />
      </>}
    <button type="button" className={styles.button} onClick={() => onStep(final.order)}>Abrir la llamada y sus reglas completas</button>
  </section>
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
