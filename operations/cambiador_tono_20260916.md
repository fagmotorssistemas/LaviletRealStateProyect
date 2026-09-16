# Cambiador de estilo

Ruta: `/inmobiliaria/automatizacion/estilo`, solo administradores con acceso al proyecto La Vilet. Incluye estilo actual/cercano/equilibrado/elegante, calidez y detalle; vista previa aislada, guardar, descartar, restaurar versión anterior y restaurar original.

## Qué cambia al usarlo

No se modifica ningún archivo. Guardar actualiza una fila de `public.agent_prompts` con `name = conversation_tone_settings`, acotada al tenant y proyecto. Su `content` contiene `current` y `previous`; `version`, `updated_by` y `updated_at` registran la edición. La fila está inactiva y sin canales porque es configuración, no un tema a incluir en prompts. El guion no la muestra como tema editable.

El perfil original es `style: actual, warmth: 1, detail: 1`. No añade instrucciones: mantiene la equivalencia de la unificación anterior. Cambiar controles solo modifica el borrador del navegador. Generar vista previa llama a IA con ejemplos aislados y los controles del borrador; no guarda ni usa mensajes de leads, ni invoca visitas, financiamiento o envíos.

## Archivos

- `src/components/inmobiliaria/automation/ConversationToneSettings.tsx` y `.module.css`: interfaz y estilos.
- `src/app/inmobiliaria/automatizacion/estilo/page.tsx` y `actions.ts`: carga, autorización, guardado, restauración y vista previa.
- `src/lib/inmobiliaria/conversationTone.ts`: valores permitidos y preferencias de redacción derivadas de los controles.
- `src/services/conversationTone.service.ts`: almacenamiento y control de versiones. Se compara el contenido y versión antes de escribir para impedir actualizaciones perdidas.
- `src/lib/integrations/automation/tone-settings.ts`: lee el perfil por proyecto para tareas de redacción. Ante fallo de lectura del estilo usa el original; tiempo de lectura limitado a tres segundos.
- `src/lib/integrations/automation/ai.ts`: conecta el perfil a generación y revisión sin aplicarlo a extractores ajenos a la redacción.
- `AutomationSectionTabs.tsx`, `AutomationSettings.tsx`: navegación del panel.
- `automationGuion.ts`, `automationGuion.service.ts`: reserva y oculta el registro técnico del cambiador.

Las preferencias prevalecen solo en estilo, calidez y extensión. No cambian hechos, consentimiento, acciones, límites del canal ni cobertura de preguntas. Los mensajes fijos y plantillas aprobadas no se reescriben. El control no reanuda leads pausados ni reenvía respuestas anteriores.

## Pruebas

`scripts/tone-controls.test.cjs`: validación, perfil original, aplicación en redacción, aislamiento de vista previa, autorización y guardados concurrentes. Se ejecutó junto con las regresiones de integraciones, continuidad, cobertura y equivalencia del tono: 216 pruebas aprobadas.
