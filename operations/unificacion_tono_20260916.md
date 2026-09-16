# Unificación del tono sin cambiar el estilo

La fuente central es `src/lib/integrations/automation/conversation-tone.ts`, objeto `CURRENT_TONE`. Conserva literalmente las instrucciones existentes de trato, cortesía, vocabulario, longitud, presentación, mensajes operativos, revisión, límites de negocio y variación de aperturas. Mantiene variantes por contexto porque convertirlas en un nuevo texto uniforme alteraría las instrucciones actuales.

## Consumidores

- `conversation-style.ts`: trato, vocabulario, aperturas y saludos.
- `commercial-experience.ts`: calidez, lenguaje, extensión y ejemplo de presentación. `sdr.ts` sigue recibiendo las mismas reglas mediante estos módulos.
- `operational-copy.ts`: redacción y revisión de citas/financiamiento.
- `turn-completeness.ts`: estilo de la revisión de cobertura.
- `response-openings.ts`: instrucciones de variación según las aperturas recientes.
- `business-scope.ts`: estilo para solicitudes ajenas al proyecto.
- `ai.ts`: instrucción de tono del redactor y expansión de referencias de los prompts almacenados.

En Supabase, los fragmentos de tono de `respuesta_comercial` y `revisor_respuesta` se sustituyen por referencias `{{conversation_tone.nombre}}`. `activePrompt` las expande antes de entregar el prompt al modelo, tanto por RPC como por consulta alternativa. No se cambia el saludo inicial ni las reglas operativas, plantillas aprobadas, precios, solicitudes pendientes o estado de los leads.

## Aplicación y recuperación

1. Desplegar primero el código que admite referencias. Mientras tanto los prompts originales siguen siendo compatibles.
2. `node scripts/unify-conversation-tone-prompts.cjs` verifica los contenidos actuales sin escribir.
3. Después del despliegue: ejecutar con `--apply`. Comprueba los hashes originales, guarda una copia completa en `tmp/tone-prompts-backup-*.json` y usa comparación del contenido previo para impedir sobrescribir cambios concurrentes. Repetirlo no vuelve a modificar prompts ya migrados. No envía mensajes.
4. Si se revierte el código a una versión sin expansión, restaurar ANTES el contenido original de esos prompts desde la copia. No dejar referencias activas en una versión que no sabe expandirlas.

## Validación

`scripts/conversation-tone.test.cjs` compara hashes de los prompts completos de redacción y revisión anteriores, las aperturas con tres historiales distintos y las instrucciones finales del redactor. También verifica que los prompts almacenados se expandan exactamente a su contenido anterior y que una referencia desconocida se rechace. La referencia de comparación está en `scripts/fixtures/conversation-tone-baseline.json`.

212 pruebas de tono, integraciones, cobertura y continuidad pasaron; lint sin errores. La generación puede variar entre ejecuciones como antes, pero esta reorganización no cambia las instrucciones enviadas. No se han creado aún barras, estilos alternativos ni una nueva sección del panel: esta entrega corresponde exclusivamente a la unificación solicitada.
