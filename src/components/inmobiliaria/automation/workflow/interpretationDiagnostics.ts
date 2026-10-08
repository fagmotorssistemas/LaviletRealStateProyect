const propertyFields: Record<string, string> = {
  primary_intent: 'turn_semantics.primary_evidence', property: 'turn_semantics.property.evidence', budget: 'turn_semantics.budget.evidence',
}
/** Describe the recorded control, without inferring a different client intent. */
export function interpretationIssueDetail(issue: string): { code: string; field: string; message: string } {
  const [code, source] = issue.split(':')
  const quantity = /^quantity\.(\d+)$/.exec(source || '')
  const request = /^requests\.(\d+)$/.exec(source || '')
  const field = propertyFields[source] || (quantity ? `turn_semantics.housing_quantities[${quantity[1]}].evidence`
    : request ? `requests[${request[1]}].evidence` : source || (code === 'invalid_budget_amount' ? 'turn_semantics.budget.amount'
      : ['unresolved_budget_role', 'inconsistent_budget_role'].includes(code) ? 'turn_semantics.budget.status' : 'Interpretación del turno'))
  const message = code === 'non_current_evidence'
    ? 'La cita usada para este campo no pertenece al mensaje actual del lead. El historial puede aclarar una referencia, pero no puede presentarse como una nueva declaración.'
    : code === 'missing_current_evidence'
      ? 'El extractor devolvió un dato o intención sin conservar la cita literal del mensaje actual que lo respalda.'
      : code === 'invalid_budget_amount'
        ? 'El importe del presupuesto no es válido o no coincide con una cantidad respaldada por su cita. No se puede comparar con los precios hasta resolverlo.'
        : code === 'unresolved_budget_role'
          ? 'No quedó resuelto si el importe declarado es presupuesto total, entrada u otro concepto. La recuperación debe conservarlo sin inventar su papel.'
          : code === 'inconsistent_budget_role'
            ? 'Los bloques de presupuesto y cantidades financieras atribuyen papeles contradictorios al mismo importe.'
            : 'Este control de la interpretación quedó sin resolver. Consulte el identificador y la salida original; no se deduce una solicitud de asesor ni un rechazo del lead.'
  return { code, field, message }
}
