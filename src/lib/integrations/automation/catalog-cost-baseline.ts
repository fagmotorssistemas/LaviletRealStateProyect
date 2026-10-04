import { object, type Row } from './data'
import { catalogDialogueReply } from './catalog-dialogue'
import { turnEvidence, verifiedClaimSources } from './turn-evidence'
import { businessRiskContext } from './business-risk-review'
import { compactTurnPromptContext } from './turn-prompt-context'
import { scopeTurnCatalog } from './turn-context-scope'
import { commercialMemory, experienceContext } from './commercial-experience'

/** Rebuild the normal catalogue evidence in memory, solely to estimate size.
 * Keep this out of verified/model inputs: it must never widen actual evidence.
 * This is not a simulation of the alternate answer or its retry decisions. */
export function catalogCostBaseline(original: Row, audit: Row, current: string, history: unknown) {
  const normal = { ...original, catalog_search: { ...object(original.catalog_search), embeddingsEnabled: false } }
  delete (normal as Row).catalog_retrieval
  delete (normal as Row).catalog_context_scope
  delete (normal as Row).catalog_summary
  const answer = catalogDialogueReply(normal, current)
  if (!answer) return null
  const normalAudit = { ...audit, ...answer.audit }
  delete normalAudit.catalog_retrieval
  delete normalAudit.catalog_context_scope
  delete normalAudit.catalog_summary
  delete normalAudit.catalog_aggregate_groups
  let verified = scopeTurnCatalog({ ...normal, catalogo: object(answer.audit.catalog_results).units,
    catalog_results: answer.audit.catalog_results, catalog_query: answer.audit.catalog_query,
    estado_operativo: normalAudit }, normalAudit)
  const evidence = turnEvidence(verified, normalAudit)
  verified = { ...verified, catalogo: evidence.units }
  delete verified.catalogo_verificacion
  const sources = verifiedClaimSources(verified, normalAudit, evidence, current)
  return (task: string, data: Row): Row | null => {
    if (task === 'writing' && data.contexto_verificado) {
      return compactTurnPromptContext({ ...data, evidencia_turno: evidence, evidencia_afirmaciones: sources,
        estado_operativo: normalAudit,
        contexto_verificado: experienceContext({ ...verified, historial: history }, current,
          commercialMemory(verified.memoria_comercial, history, current)) })
    }
    if (task === 'review' && data.fuentes_autorizadas) {
      const expanded = businessRiskContext({ current, reply: String(data.borrador || ''),
        obligations: Array.isArray(data.obligaciones_del_turno) ? data.obligaciones_del_turno.map(object) : [],
        units: evidence.units, groups: evidence.groups, projectFacts: evidence.project_facts,
        claimSources: sources, verified, audit: normalAudit,
        allowedLinks: (object(data.fuentes_autorizadas).enlaces_permitidos || []) as string[] })
      // Retain retry metadata and the same draft; do not predict a new review.
      return { ...data, ...expanded }
    }
    return null
  }
}
