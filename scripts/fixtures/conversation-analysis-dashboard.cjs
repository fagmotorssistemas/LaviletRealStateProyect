/* Fictional, browser-only data. Never used by application routes or live services. */
function analysisDashboardFixture() {
  const now = new Date().toISOString(), at = minutes => new Date(Date.now() - minutes * 60000).toISOString()
  const names = ['María Torres', 'Andrés Molina', 'Lucía Ramírez', 'Diego Castro', 'Sofía Andrade', 'Pablo Moreno', 'Valentina Ríos', 'Jorge Salazar']
  const items = names.map((name, index) => ({
    id: '10000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'), name, projectId: index === 7 ? 'project-2' : 'project-1', projectName: index === 7 ? 'Proyecto de prueba' : 'La Vilet',
    createdAt: at(3000 + index * 200), source: index % 3 === 0 ? 'Showroom 360' : 'WhatsApp', temperature: index < 3 ? 'caliente' : index < 6 ? 'tibio' : 'frio',
    residence: index % 3 === 0 ? 'Sin residencia declarada' : index % 2 ? 'Cuenca' : 'Quito', category: ['penthouse', 'departamento', 'suite', 'local'][index % 4],
    advisorId: index === 0 ? '' : 'advisor-1', advisorName: index === 0 ? 'Sin asignar' : 'Asesor de prueba', kommoId: 4000000 + index,
    stage: ['proceso_reserva', 'interes_comercial', 'necesidad_identificada', 'contacto_inicial', 'interes_comercial', 'contacto_inicial', 'nuevo', 'venta_cerrada'][index],
    stageLabel: ['Proceso de reserva', 'Interés comercial', 'Necesidad identificada', 'Contacto inicial', 'Interés comercial', 'Contacto inicial', 'Nuevo / Por atender', 'Venta cerrada'][index],
    stageAt: at(100 + index), stageProvisional: false, moment: ['reservation', 'price', 'financing', 'visit', 'options', 'discovery', 'entry', 'closure'][index],
    momentLabel: ['Solicitud de reserva', 'Precio y presupuesto', 'Financiamiento', 'Coordinación de visita', 'Opciones y selección', 'Presentación y necesidades', 'Entrada y primera atención', 'Cierre comercial'][index],
    waiting: index < 2 ? 'team' : index === 5 ? 'planned' : 'customer', waitingSince: at(120 + index * 30), lastCustomerAt: at(150), lastResponseAt: at(140),
    lost: false, won: index === 7, futureInterest: index === 5, contactStopped: false,
    signals: index === 0 ? [{ key: 'reservation_unassigned:r1', label: 'Reserva solicitada sin asesor', detail: 'La solicitud existe y todavía no tiene responsable.', source: 'lead_reservation_requests:r1', at: at(60), priority: 'high', nextStep: 'Asignar y comprobar la atención de la solicitud.' }]
      : index === 1 ? [{ key: 'advisor_overdue', label: 'Plazo de atención vencido', detail: 'Venció el plazo configurado para esta derivación.', source: 'leads.seller_response_due_at', at: at(200), priority: 'high', nextStep: 'Atender la consulta pendiente.' }] : [],
    factors: index === 1 ? [{ kind: 'customer', reason: 'price', basis: 'explicit', explanation: 'El cliente expresó que el precio supera el presupuesto previsto; mantiene su interés en revisar alternativas.', next_step: 'Explicar las opciones verificadas sin interpretar la objeción como rechazo.', evidence: [{ message_id: 'm1', quote: 'Se sale de mi presupuesto, pero quiero ver alternativas.' }] }]
      : index === 4 ? [{ kind: 'conversation', reason: 'context_loss', basis: 'hypothesis', explanation: 'Conviene comprobar si se conservó la unidad que estaba comparando.', next_step: 'Revisar el referente de la última consulta.', evidence: [{ message_id: 'm4', quote: 'Me refería al otro departamento.' }] }] : [],
    timeline: [{ id: 'm1', at: at(150), label: 'Cliente', detail: 'Me interesa conocer las opciones del proyecto.', kind: 'message' }, { id: 'b1', at: at(140), label: 'Bot', detail: 'Con gusto le compartimos la información verificada.', kind: 'message' }],
    analysis: index === 6 ? null : { version: 2, summary: 'Busca una opción de vivienda y desea continuar comparando las alternativas disponibles.', goal: 'Encontrar una vivienda acorde a sus necesidades', next_step: 'Resolver la consulta actual y conservar sus preferencias.' },
    analysisId: index === 6 ? null : 'evaluation-' + index, reviewAt: index === 6 ? null : at(100), stale: index === 2,
    reviews: [], signature: 'a'.repeat(64), canReview: true, recovery: null,
    coverage: { messages: true, whatsapp_evidence: true, conversations: true, reviews: true, analyses: true, jobs: true }, warnings: [],
    milestones: ['response', ...(index < 5 ? ['needs'] : []), ...(index === 0 ? ['reservation'] : []), ...(index === 3 ? ['visit'] : []), ...(index === 7 ? ['sale'] : [])],
    firstResponseSeconds: index % 3 ? 120 + index * 35 : null, firstAdvisorSeconds: index % 2 ? 1400 + index * 90 : null,
    nextStep: index === 0 ? 'Asignar y comprobar la atención de la solicitud.' : 'Resolver la consulta actual y conservar sus preferencias.', codeVersion: 'fixture-only',
  }))
  return { items, asOf: now, warnings: [] }
}
function actionsMockSource() {
  return `const data=(${analysisDashboardFixture.toString()})();window.__evaluations=0;window.__reviews=0;
export async function getConversationAnalysisDashboard(){return structuredClone(data)}
export async function getConversationAnalysisDetail(id){return structuredClone(data.items.find(i=>i.id===id))}
export async function evaluateConversation(id){window.__evaluations++;const i=data.items.find(i=>i.id===id);i.analysis={version:2,summary:'Evaluación actualizada con evidencia.',goal:'Continuar la compra'};i.stale=false;return{ok:true}}
export async function saveConversationAnalysisReview(input){window.__reviews++;data.items.find(i=>i.id===input.leadId).reviews.unshift({id:'review-'+window.__reviews,status:input.status,note:input.note,createdAt:new Date().toISOString(),signature:input.signature,actor:'Asesor de prueba'});return{ok:true}}`
}
module.exports = { analysisDashboardFixture, actionsMockSource }
