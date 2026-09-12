# Experiencia comercial del bot

El bot prioriza lo que el cliente quiere vivir o conseguir con su inversión. Responde primero a su consulta con lenguaje cotidiano, normalmente en 25 a 55 palabras. Explica como máximo uno o dos beneficios relevantes y evita enumerar instalaciones o pedir datos como si fuera un formulario.

## Memoria y datos

El campo existente `conversations.summary` conserva `_commercial_memory`: beneficios mencionados y datos que el cliente aún no sabe definir. Esta memoria se combina con el historial reciente, se mantiene al regenerar el resumen y solo se actualiza después de un envío aceptado. El reinicio de la conversación también la elimina.

Piscina, gimnasio y otros beneficios ya explicados se omiten de la presentación siguiente, salvo consulta expresa. Las áreas siguen en el inventario; el contexto comercial las incorpora cuando se pregunta por tamaño, distribución o comparación. No inventa un total ni convierte un exterior sin registrar en cero.

Si el cliente no sabe el tamaño, se orienta con ejemplos o un rango real. Si se rechazan los borradores, la alternativa usa datos del catálogo o aclara la consulta; no repite automáticamente la siguiente pregunta del formulario.

## Posicionamiento

El responsable indicó un sector residencial exclusivo y de alta plusvalía. Se incorpora como enfoque comercial de ubicación y potencial de valorización, sin cifras, rentabilidad garantizada ni un estudio de demanda inventado. La tranquilidad se relaciona con las medidas registradas del edificio. Se mencionan únicamente lugares del entorno registrados y se distinguen de los servicios dentro del proyecto.

No se promete que hay de todo, que no hace falta salir ni que los locales contienen negocios ya operativos. Tampoco se asignan parqueaderos a visitantes ni se califica un exterior como privado sin datos específicos.

## Alcance y comprobación

- Cambios en conversación, memoria, generación, revisión y respuesta alternativa comercial.
- Los guiones `respuesta_comercial` y `revisor_respuesta` se actualizan con `node scripts/update-experience-prompts.cjs --apply`. Guarda respaldo y protege ediciones concurrentes; sin `--apply` solo muestra la propuesta.
- No requiere tablas ni migraciones nuevas. No modifica áreas, precios, agenda ni contactos.
- Validación: `npm run test:integrations`, `npm run build` y `node scripts/evaluate-commercial-experience.cjs`.
- Las evaluaciones usan datos reales del proyecto y conversaciones sintéticas: no mandan WhatsApp ni modifican leads.
