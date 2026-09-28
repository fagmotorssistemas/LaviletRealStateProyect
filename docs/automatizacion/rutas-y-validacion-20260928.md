# Coherencia de rutas, preguntas y respaldo

## Incidente comprobado

En la ejecución `a35084bf-ef6d-4992-b0b6-fd795c266c1e`, el extractor identificó una búsqueda de viviendas con 5 o 6 dormitorios y `visit_intent=none`. Una regla de continuidad de visitas interpretó la disponibilidad como coordinación y seleccionó `visit_intake`. El redactor contestó sobre dormitorios, pero un control operativo rechazó su pregunta porque la plantilla de horarios no contenía ninguna. El respaldo enviado no contestaba la consulta.

## Cambios generales

- `src/lib/integrations/automation/route-consistency.ts`: contrasta las solicitudes de alta confianza con la intención de visita. Si existe otra consulta explícita y la interpretación descarta visita, una coordinación pendiente no autoriza continuarla. Las solicitudes mixtas que sí incluyen visita conservan ese flujo.
- `src/lib/integrations/automation/conversation.ts`: aplica esa decisión antes de continuar una coordinación o clasificar respuestas a propuestas. Registra `route_consistency` con los temas actuales, intención y motivo. No modifica la cita anterior ni la cancela.
- `src/lib/integrations/automation/operational-copy.ts`: distingue más de una pregunta de una pregunta añadida sin revisión. En revisión con evidencia, no exige igualdad de todas las cifras con una plantilla; permanecen los controles de datos, enlaces y estado operativo.
- `src/lib/integrations/automation/turn-completeness.ts`: permite reformular preguntas protegidas cuando existe revisión semántica. Exige pregunta con propósito y revisión del objetivo operativo; conserva verificaciones de cifras, catálogo y afirmaciones. Una solicitud señalada como omitida por el respaldo se contrasta con la cobertura estructurada del catálogo. Si no está cubierta, se invalida ese respaldo y se registra el motivo, sin convertir automáticamente la omisión en una derivación.
- `src/lib/integrations/automation/response-plan.ts`: aclara que proteger una decisión no exige copiar literalmente su pregunta.
- `src/components/inmobiliaria/automation/workflow/messageExplanation.ts` y `reviewDecision.ts`: explican la decisión de ruta, la validación del respaldo y el significado de los controles. Los registros históricos de `question_count` siguen distinguiéndose: podían rechazar una sola pregunta añadida a una plantilla sin interrogación.

## Límites y verificación

La comprobación de ruta se basa en señales de alta confianza; no convierte ambigüedad en consentimiento. La revisión no garantiza que cualquier redacción de IA sea aceptada. El respaldo no tiene un nuevo agente independiente: utiliza la cobertura registrada y la evidencia del catálogo, además de los controles de contenido existentes. Si estos controles no permiten una respuesta completa, se informa de la imposibilidad de verificarla en vez de enviar una respuesta ajena al tema.

Pruebas en `scripts/integrations.test.cjs`, `scripts/turn-completeness.test.cjs` y `messageExplanation.test.ts`: consulta exacta del incidente con visita pendiente, prioridad de otras consultas, solicitudes mixtas, preguntas con propósito, respaldo incompleto y explicación visible. No se modifican tiempos de agrupación ni recepción de leads.

Validación: 225 pruebas de integración, 58 de revisión y 30 de interfaz aprobadas; TypeScript sin errores. La suite amplia detectó también dos pruebas de fechas en `scripts/visit-date-context.test.cjs` que esperan coordinar un lunes a las 10:00 usando el reloj actual y reciben `past`; ese archivo y sus migraciones no se modificaron en esta corrección.
