# Continuación comercial según el contexto

## Problema y cambio

La ruta `property_budget_deferred` protegía literalmente la pregunta de la respuesta base. Una propuesta de comparar alternativas o explorar financiamiento era rechazada con `protected_question_changed`, aunque atendiera mejor la preocupación económica. Las rutas de selección, comparación de plantas, alternativas y presupuesto ahora permiten adaptar la pregunta comercial. No se modifica la pertenencia de los leads al proyecto ni se ejecutan acciones comerciales desde la redacción.

La IA conserva la selección explícita como referencia: ofrecer alternativas no significa que el cliente ya eligió otra unidad. Puede proponer dos caminos en una sola pregunta, sin estar obligada a pedir presupuesto ni a repetir la elección de planta. Las alternativas más económicas requieren precios verificados; las condiciones de precio y las restricciones financieras siguen siendo obligatorias.

## Archivos

- `src/lib/integrations/automation/response-plan.ts`: `commercialContinuationSources` separa las rutas comerciales de las operativas protegidas; `COMMERCIAL_CONTINUATION_RULES` define la libertad y sus límites para redactor y revisor.
- `src/lib/integrations/automation/turn-completeness.ts`: desactiva la preservación de la pregunta base solamente en esas rutas; exige revisión independiente, aporta la selección del contexto y registra `commercial_continuation`. El control `operational_goal_preserved` debe rechazar cambios de selección no solicitados, preguntas resueltas y desviaciones de la necesidad actual. Las reparaciones del revisor utilizan las mismas reglas.
- `src/components/inmobiliaria/automation/workflow/messageExplanation.ts`: añade «Objetivo y continuación comercial», con necesidad actual, selección de referencia, pregunta, dato buscado, propósito y resultado registrado. Los registros antiguos no reciben explicaciones inventadas.
- `scripts/turn-completeness.test.cjs`: prueba una unidad distinta de las del incidente, aceptación de la nueva pregunta, rechazo independiente por objetivo incumplido y conservación del bloqueo operativo.
- `src/components/inmobiliaria/automation/workflow/messageExplanation.test.ts`: verifica la explicación visible y la ausencia del bloque en registros sin esos datos.

## Límites y comprobación

Las preguntas de citas, selección financiera y atención del equipo siguen protegidas. Los controles de catálogo, cifras, URLs y afirmaciones operativas se conservan. La revisión de propósito es semántica: no garantiza que una IA nunca se equivoque. La interfaz distingue la propuesta revisada del mensaje finalmente enviado; una aprobación en este paso no acredita entrega por Kommo.

Las pruebas usan respuestas simuladas para verificar las decisiones del código. No envían mensajes ni certifican que el modelo en producción elegirá siempre una redacción concreta. Los nuevos detalles aparecen en las ejecuciones posteriores al despliegue.
