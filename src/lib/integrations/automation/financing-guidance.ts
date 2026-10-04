import { object, text, type Row } from './data'
import { FINANCING_STAGE_RULES } from './financing-stage'

/** Uses the existing, grounded interpretation; never reinterprets customer prose. */
export function hasFinancingRequest(extracted: Row): boolean {
  const semantics = object(extracted.turn_semantics)
  return semantics.confidence === 'high' && semantics.primary_intent === 'ask_financing'
    || (Array.isArray(semantics.requests) && semantics.requests.map(object)
      .some(request => request.domain === 'financing' && request.confidence === 'high'))
}

// These are the fields collected by process_financing_message_v3 and
// financingReply, not a bank's underwriting/document checklist.
export const FINANCING_PROCESS_RULES = `
## Procedimiento de revisión financiera de La Vilet
Distinga explicar el proceso de iniciarlo. Una pregunta sobre requisitos, pasos o viabilidad no concede consentimiento ni pide una derivación. Puede responder estas preguntas por este chat sin enviar al cliente a un asesor por rutina.
Nuestra revisión preliminar requiere aceptación, una unidad concreta elegida por el cliente y elección de una entidad disponible. Si acepta antes de elegir inmueble, conserve esa aceptación y retome la selección del inmueble; no pida datos financieros todavía. Los datos iniciales son nombres y apellidos completos como aparecen en su cédula, número de cédula y si trabaja bajo relación de dependencia o de manera independiente. El nombre de presentación no confirma el nombre legal. Acepte un solo nombre o apellido cuando así lo confirme el cliente. Después se recopilan antigüedad laboral y cargo para dependientes e ingreso mensual en ambos casos. Nunca solicite RUC, tampoco a independientes. Si el cliente lo ofrece, el sistema valida si puede obtener su cédula personal. Solicite solo el siguiente dato pendiente del estado operativo; una explicación de requisitos no exige que el cliente los entregue todavía.
Si pregunta qué datos necesitamos para esta revisión, explique los requisitos de NUESTRO proceso. No los sustituya por una lista genérica de documentos bancarios. Estados de cuenta, declaraciones tributarias, historial crediticio, activos, deudas o pasaporte no son requisitos acreditados de este flujo: solo atribúyalos a una entidad si una fuente bancaria autorizada concreta los establece. Decir «normalmente» o «podría requerirse» no acredita esa fuente. Puede explicar que la entidad confirmará sus requisitos adicionales, sin inventar una lista.
El bot puede explicar y recoger progresivamente los datos autorizados. El equipo interno revisa el expediente cuando esté listo; la entidad decide la aprobación y las condiciones. Explique esta secuencia cuando la consulta lo requiera, sin afirmar que ya comenzó, se derivó o fue aprobada. No añada por costumbre la misma invitación de asesor en cada respuesta.
${FINANCING_STAGE_RULES}
`

export const ASSISTANCE_CONTINUATION_RULES = `Responda con las fuentes y el procedimiento disponibles. Ofrezca atención humana cuando el cliente la pida, una gestión realmente requiera al equipo o falte un dato concreto que deba verificar. No use ofrecer un asesor como cierre automático ni como sustituto de explicar lo que sí conoce. Si ya ofreció esa ayuda y el cliente sigue preguntando, atienda su nueva consulta sin repetir la oferta salvo una necesidad nueva. Una respuesta informativa puede terminar sin pregunta. Esto orienta la redacción; una oferta opcional por sí sola no justifica rechazar un mensaje útil.`

export function financingCollectionActive(audit: Row): boolean {
  return audit.source === 'financing'
    && /^(?:identificacion|nombre|cedula|tipo_solicitante|estabilidad|cargo|ingreso|ruc)_pendiente$/.test(text(audit.state))
}
