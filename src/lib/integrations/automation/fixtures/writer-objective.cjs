// A simulated writer for integration tests. It creates its own wording from
// the objective/known facts; no literal server question enters the model input.
exports.writerQuestion = function writerQuestion(data = {}) {
  const context = data.contexto_verificado || data
  const plan = context.siguiente_paso_comercial || data.estado_operativo?.commercial_journey || data
  const goal = plan.objetivo_conversacion || plan
  const id = goal.question_id || plan.question_id || data.contrato_redaccion?.objetivo_siguiente?.question_id
  const action = plan.action || goal.action
  const questions = {
    property_category: action === 'discover_use' ? '¿Lo está pensando para vivienda o para un local comercial?' : '¿Le gustaría explorar departamentos o penthouses?',
    property_purpose: '¿Lo está pensando para vivir o para invertir?',
    property_bedrooms: '¿Cuántos dormitorios le gustaría que tuviera su vivienda?',
    budget_amount: '¿Qué presupuesto total aproximado tenía pensado para la compra?',
    budget_kind: '¿Ese importe lo tenía pensado como presupuesto total o como entrada?',
    property_floor: '¿En qué planta le gustaría revisar las opciones?',
    financing_invitation: '¿Le gustaría continuar con el financiamiento?',
    financing_down_payment: '¿Qué monto tendría previsto para la entrada?',
    unit_choice: '¿Cuál de estas opciones le gustaría revisar?',
  }
  return questions[id] || ''
}
exports.writerProfileQuestion = function writerProfileQuestion(id, introduction = {}) {
  if (id === 'lead_profile') return 'Para compartirle el brochure y orientarle, ¿podría decirme su nombre y en qué ciudad o país reside actualmente?'
  if (id === 'lead_profile_name') return '¿Cómo le gustaría que le llamemos?'
  if (id === 'lead_residence_confirmation') return `¿${introduction.candidate?.city || 'Ese lugar'} es también su residencia actual?`
  return '¿En qué ciudad o país reside actualmente?'
}
