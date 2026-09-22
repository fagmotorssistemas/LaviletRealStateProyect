# Redactor final de la automatización

El redactor común atiende las respuestas comerciales y operativas de la conversación: presentación, catálogo, comparaciones, precios, financiamiento y visitas. No sustituye al intérprete ni ejecuta acciones.

## Flujo

1. Las reglas y consultas construyen una respuesta base con hechos y el siguiente paso.
2. `response-plan.ts` construye `finalWriterContract`: ruta, hechos, cifras, enlaces, pregunta pendiente, acción y decisión de saludo.
3. `turn-completeness.ts` entrega ese contrato, la base, el mensaje, el historial reciente y el contexto verificado al redactor existente.
4. Se validan datos, enlaces, catálogo y estados operativos. Una propuesta modificada pasa también por revisión semántica.
5. Si falla la generación o se rechaza la propuesta, se conserva la base. El sistema aplica el saludo y las validaciones finales antes del envío.

`locked` protege decisiones y hechos; ya no impide mejorar su redacción. En esas rutas se conserva literalmente la pregunta siguiente y se aplican los controles de `operationalCopyIssues`.

No se añade otra llamada de redacción encima de `operationalReply`: esa llamada previa se retiró del orquestador de conversación. Otros usos del módulo no cambian.

## Excepciones

Los saludos simples, cortesías, problemas de medios, aclaraciones de alcance, respuestas fuera del negocio, la ruta `commercial_location_budget` y los avisos finales críticos mantienen su tratamiento directo. Este cambio no abarca campañas, recordatorios u otros emisores externos al flujo de conversación.

## Cómo investigar

En la ejecución, revisar `response_coverage`: base, propuesta, resultado y motivos de rechazo. En `turn_completeness.writer_contract` queda el contrato utilizado, tanto si se acepta la propuesta como si se conserva la base. No se agregó un editor visual de prompts.

- Si la base omite un brochure obligatorio o elige mal las opciones, revisar la ruta que construyó la base.
- Si la base es correcta pero la propuesta es pobre, revisar `FINAL_WRITER_RULES` y las reglas específicas en `turn-completeness.ts`.
- Si se conserva la base, revisar `status` e `issues` antes de modificar el prompt.

El contrato es dinámico: no contiene una instrucción fija de presentar el proyecto para todas las consultas. No cambia la política existente de saludo ni garantiza por sí mismo que la ruta inicial sea correcta. Las rutas que antes omitían el redactor ahora pueden requerir una llamada de escritura y otra de revisión, aumentando su latencia y consumo.
