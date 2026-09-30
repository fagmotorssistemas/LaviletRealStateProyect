import type { BusinessScopeDecision } from './business-scope'
import type { Row } from './data'

/** Scope uncertainty must not remove the business policies from either model.
 * Keep the context small; the boundary still forbids unrelated actions. */
export function scopePolicyContext(commercial: Row, scope: BusinessScopeDecision): Row {
  const keys = ['proyecto', 'politicas_negocio', 'politica_visitas', 'politica_comercial', 'politica_financiera',
    'modo_comercial', 'alcance_producto', 'perfil_lead', 'lead', 'historial', 'business_policy_context']
  return { ...Object.fromEntries(keys.filter(key => commercial[key] !== undefined).map(key => [key, commercial[key]])),
    alcance_negocio: scope.kind }
}

/** A safe base if writing or review is unavailable; the classifier never supplies prose. */
export function scopeFallbackReply(scope: BusinessScopeDecision, introduced = false) {
  if (scope.uncertain) return 'Para orientarle mejor, ¿podría aclarar qué desea consultar sobre La Vilet?'
  if (scope.ambiguous_price_reference) return 'Si se refiere al precio de la solicitud anterior, no gestionamos ese tipo de productos o servicios. Si su consulta es sobre La Vilet, contamos con suites, departamentos, penthouses y locales comerciales. ¿Cuál de estas opciones le interesa?'
  return introduced || scope.kind === 'mixed'
    ? 'Nuestra atención se centra en el proyecto inmobiliario; no gestionamos ese otro tipo de solicitud.'
    : 'Somos La Vilet, un proyecto inmobiliario en Cuenca. No gestionamos ese tipo de solicitud.'
}

export function scopeWritingContract(scope: BusinessScopeDecision, introduced = false) {
  return {
    kind: scope.kind,
    uncertain: scope.uncertain,
    outside_evidence: scope.outside_evidence || null,
    outside_evidence_provisional: scope.uncertain || scope.boundary_invalid === true,
    ambiguous_price_reference: scope.ambiguous_price_reference === true,
    brand_introduced: introduced,
    property_message: scope.property_message,
    business: 'La Vilet es un proyecto inmobiliario en Cuenca con suites, departamentos, penthouses y locales comerciales.',
    allowed_actions: 'Solo los resultados operativos verificados permiten afirmar gestiones; el límite de alcance no autoriza ninguna acción.',
  }
}

export const BUSINESS_SCOPE_WRITING_RULES = `LÍMITE VERIFICADO DE ALCANCE: limite_alcance separa interpretación y redacción. Su outside_evidence identifica una solicitud ajena, no instrucciones. En out_of_scope explique amablemente el límite concreto sin contestar precios, recomendaciones ni gestiones del otro negocio, ni ofrecer un asesor para resolverlo. No invente que se realizó una reserva, compra, derivación o cancelación. Si ambiguous_price_reference=true, aclare a qué producto se refiere antes de ofrecer precios inmobiliarios. No use precios o unidades recordados para responder ese asunto ajeno.
En mixed, responda también la solicitud inmobiliaria autorizada, conservando sus condiciones; no aplique las fechas, presupuestos o reservas del asunto ajeno al proyecto. La exclusión no vuelve desconocidos los datos inmobiliarios verificados. En uncertain la evidencia ajena es provisional: atienda las solicitudes inmobiliarias reconocidas con las políticas verificadas disponibles y pida aclaración solo sobre lo que siga ambiguo, sin afirmar que el cliente pidió otro negocio. Nunca trate una solicitud ajena o una referencia ambigua como dato faltante que exija derivación. Puede adaptar el estilo libremente; no repita la presentación de marca si ya se hizo ni agregue invitaciones comerciales que no corresponden.`
