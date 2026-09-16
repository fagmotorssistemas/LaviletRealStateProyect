# Tono configurable más diferenciado

El perfil original `actual / 1 / 1` conserva exactamente los prompts anteriores. No se modifica el perfil guardado por el administrador ni se requiere SQL.

- `src/lib/inmobiliaria/conversationTone.ts`: instrucciones concretas para cada estilo, nivel de calidez y detalle. Reservado evita cortesías rutinarias; cálido reconoce necesidades expresadas. Breve prioriza una o dos frases para consultas simples; explicativo desarrolla diferencias o pasos verificados cuando aportan valor.
- `src/lib/integrations/automation/tone-settings.ts`: sustituye las cláusulas configurables conservando límites de negocio. AsyncLocalStorage conserva una instantánea por conversación, aislada de otras conversaciones; un fallo al leer la configuración utiliza el original.
- `ai.ts`, `sdr.ts`, `operational-copy.ts`, `turn-completeness.ts`, `business-scope.ts`: identifican explícitamente las tareas de redacción/revisión; extracción y resúmenes no reciben instrucciones de personalidad.
- `conversation.ts`: crea la instantánea y registra `tool_calls.conversation_tone` con estilo, calidez, detalle, versión, fuente y si se aplicó a una tarea de redacción/revisión. Este indicador no garantiza que el mensaje final sea generado: pueden actuar respuestas fijas o guardas posteriores.
- `conversation-tone.ts` y `commercial-experience.ts`: centralizan también una instrucción de extensión que aún estaba repetida, manteniendo su texto original.
- `src/app/inmobiliaria/automatizacion/estilo/actions.ts`: la vista previa usa explícitamente la tarea de redacción y el perfil seleccionado, sin cambiar la configuración guardada.

Los controles siguen guardando datos en `agent_prompts`, nombre `conversation_tone_settings`. Manipularlos no reescribe archivos. Plantillas aprobadas y respuestas fijas conservan su texto. La extensión se adapta a la consulta; explicativo no obliga a alargar un saludo.

Validación: pruebas de paridad exacta del original, aislamiento de conversaciones simultáneas, edición de configuración durante un turno, preservación de restricciones, fallo de lectura y ausencia de tono en tareas de datos. No se envían mensajes reales como parte de estas pruebas.
