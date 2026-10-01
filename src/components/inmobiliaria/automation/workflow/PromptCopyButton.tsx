'use client'

import { useState } from 'react'
import { Copy } from 'lucide-react'
import type { WorkflowExecutionStep } from './executionWorkflow'
import { promptExport } from './promptExport'
import styles from './MessageTraceView.module.css'

export function PromptCopyButton({ step }: { step: WorkflowExecutionStep }) {
  const [copied, setCopied] = useState('')
  const [manual, setManual] = useState('')
  const capture = promptExport(step)
  if (!capture) return <p>No se conservó el prompt de esta llamada.</p>
  async function copy() {
    try {
      await navigator.clipboard.writeText(capture!.text)
      setCopied(capture!.text)
      setManual('')
    } catch { setManual(capture!.text); setCopied('') }
  }
  return <div className={styles.promptCopy}>
    <button type="button" className={styles.button} onClick={() => void copy()}>
      <Copy size={16} aria-hidden="true" />{capture.partial ? 'Copiar captura del prompt' : 'Copiar prompt completo'}
    </button>
    <small>{capture.notice}</small>
    <span role="status">{copied === capture.text ? 'Copiado: instrucciones, datos de entrada, formato de salida y configuración.' : ''}</span>
    {manual === capture.text && <label>El navegador no permitió copiar. Seleccione este contenido y pulse Ctrl+C.
      <textarea readOnly aria-label="Prompt para copiar manualmente" value={capture.text} onFocus={event => event.currentTarget.select()} />
    </label>}
  </div>
}
