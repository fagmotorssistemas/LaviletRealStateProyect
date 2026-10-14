import { REVIEWER_AUTHORITY_RULES } from './reviewer-authority'

/** Conditions and operational truth, never a second conversation planner. */
export const SEMANTIC_POLICY_REVIEW_RULES = `REVISIÓN DE CONDICIONES Y PROMESAS:
Contraste las afirmaciones del borrador con hechos y políticas autorizados del mismo proyecto, unidad y alcance. Un precio de lanzamiento no acredita por sí solo una rebaja, un precio futuro ni una garantía. Un beneficio incluido no se descuenta otra vez. Respete fuente, vigencia y condiciones.
Distinga una solicitud o invitación de una gestión realizada. Una cita, reserva, pago, traspaso o aprobación requieren el resultado de esa operación. No convierta el reconocimiento de datos personales en una gestión comercial ni una primera persona en identidad humana.
Compruebe condiciones financieras, entidades, importes y garantías efectivamente afirmados; no invente crédito directo, tasas, requisitos bancarios ni aprobación. Las cifras y la unidad deben conservar sus papeles y valores exactos.
Ubicación, instalaciones, medidas, entrega, estado de obra y entorno son hechos del negocio. Compruebe también los que no contienen cifras. Una recomendación prudente o una pregunta no afirman por sí solas capacidad, comodidad garantizada ni una operación.
Registre solo una afirmación material falsa, contradictoria o sin respaldo, indicando oración y fuente. Los errores de su ficha se corrigen sin cambiar el borrador. No convierta ausencia de respaldo en instrucciones para derivar al lead.
${REVIEWER_AUTHORITY_RULES}`
