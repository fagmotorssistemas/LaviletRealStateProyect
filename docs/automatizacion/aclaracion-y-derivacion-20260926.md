# Aclaraciones y derivación al asesor

La ejecución de las 12:19 del 26 de septiembre aprobó una pregunta para identificar la propiedad, pero el revisor también incluyó la consulta de precio en `missing_fact_fragments`. La derivación posterior eliminó la pregunta y añadió el aviso de asesor.

## Corrección

- `coverage-evidence.ts`: contrasta cada faltante con la solicitud. Si su evidencia incluye la pregunta de aclaración aprobada y el propósito fue validado, registra `clarification_needed`. No genera derivación por esa consulta. Las solicitudes independientes realmente marcadas como datos faltantes se conservan. Una contradicción entre una solicitud atendida y un faltante se registra como `review_conflict`, salvo cuando la base ya identificaba un dato faltante real.
- `turn-completeness.ts`: explica esta distinción al revisor. Las contradicciones restantes reciben un intento de reparación dentro del presupuesto existente; si persisten, no autorizan por sí solas una derivación. El registro conserva los motivos y no oculta las clasificaciones originales.
- `handoff-copy.ts` y `conversation.ts`: el aviso de derivación se añade sin eliminar la pregunta del texto revisado. Se registra el antes y después. Las derivaciones explícitas u operativas siguen activas. Los campos de continuación comercial y transformaciones se copian ahora también al paso visible de revisión.
- `messageExplanation.ts`: describe aclaraciones, contradicciones y faltantes por separado. La revisión muestra las transformaciones posteriores registradas en validación final, sin presentar la respuesta intermedia como enviada.

## Verificación

Pruebas simuladas reproducen el precio ambiguo aprobado y marcado como faltante, un turno mixto con una política ausente que sí requiere asesor, contradicciones persistentes, y conservación de preguntas al añadir avisos. La interfaz prueba la conexión entre revisión y validación posterior. No se ejecutan derivaciones ni mensajes reales durante las pruebas; tampoco se revierten asignaciones existentes.
