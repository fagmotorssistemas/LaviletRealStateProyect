# Integridad del texto de financiamiento

## Causa

`currentTopicReply` eliminaba la expresión «no ofrece crédito directo» mediante una sustitución parcial cuando el mensaje no mencionaba crédito directo explícitamente. Ante una consulta general de financiamiento, dejaba una oración como «La Vilet , pero puede solicitar…». La revisión aprobaba el texto resultante; no era un fallo de entrega de Kommo.

## Cambio

- `src/lib/integrations/automation/current-topic.ts`: conserva el texto completo. La función mantiene su firma por compatibilidad; ya no elimina cláusulas, tampoco en los controles posteriores a la revisión.
- `src/lib/integrations/automation/turn-completeness.ts`: la redacción puede conservar la aclaración ante consultas generales de financiamiento. La revisión de `answered_content_preserved` incluye coherencia y oraciones completas; un fallo activa la reparación existente. Se registran las transformaciones de preparación y normalización con sus textos antes y después.
- `src/lib/integrations/automation/conversation.ts`: registra las diferencias entre el texto anterior al formato/validación final y el texto preparado para Kommo, incluyendo vista previa final completa hasta el límite del mensaje.
- `src/components/inmobiliaria/automation/workflow/messageExplanation.ts`: muestra «Cambios del sistema sobre el texto» en revisión y validación final. No atribuye cambios históricos sin datos ni confunde aprobación con entrega.

La selección de contenido pertinente corresponde al redactor y al revisor. Si estos fallan, se conserva la base completa según los controles existentes; no se mutila para ocultar una frase repetitiva. La revisión semántica puede equivocarse: estas comprobaciones reducen el riesgo, no garantizan corrección gramatical universal. Los cambios posteriores a la revisión quedan trazados; no se añade otra llamada al modelo para cada cambio de formato.

## Pruebas

`scripts/current-topic.test.cjs` reproduce el texto del incidente y comprueba que no se recorte ante distintos mensajes. `scripts/turn-completeness.test.cjs` verifica conservación, trazabilidad de normalización y reparación cuando el revisor detecta texto incompleto. `messageExplanation.test.ts` verifica la presentación del antes/después en ambos pasos. Las respuestas del modelo se simulan: no se envían mensajes de prueba al lead.
