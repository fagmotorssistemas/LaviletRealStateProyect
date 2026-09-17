# Estado del proyecto, visitas y aceptación contextual

## Acceso

Administrador → Inmobiliaria → Automatización → Estado del proyecto.
Ruta: `/inmobiliaria/automatizacion/proyecto`.

La nueva sección separa la etapa comercial del estado físico: sin iniciar, en construcción, obra terminada o por verificar. Incluye fecha de verificación, avance comprobado, lugares habilitados, lugar principal, condiciones de acceso y hasta 12 materiales con enlace HTTPS, fecha, tipo y autorización. No sube archivos ni verifica automáticamente el avance de obra.

Hasta el primer guardado se conserva la configuración anterior. El administrador debe verificar los datos y pulsar **Guardar y aplicar**. Sin destinos habilitados no se inicia una solicitud de visita. Los materiales no autorizados quedan fuera del contexto del bot.

## Reglas conservadas

- `projects.policies_json.bot_pricing.launch_prices_visible` no cambia. Precios sigue administrando su permiso independiente, incluso en lanzamiento.
- `bot_visits.allow_suggestions` sigue controlando las invitaciones proactivas. Un cliente puede pedir una visita por iniciativa propia si existe un destino habilitado.
- La etapa comercial, los precios publicados y el perfil de tono no se modifican al guardar esta sección.
- No se confirman horarios sin disponibilidad y aprobación. Citas existentes conservan su ubicación registrada; no se convierten automáticamente en recorridos de otra clase.

## Conversación

La regla global de invitaciones aplica a todos los estilos y barras: una acción propuesta termina en una pregunta clara, evitando mezclar alternativas. «Listo, está bien» después de una invitación explícita continúa la coordinación. Si la propuesta anterior era ambigua, se aclara si desea una visita antes de iniciarla. No se interpreta cualquier agradecimiento como una reserva.

El estado físico configurado se incorpora al contexto comercial y a la revisión de respuestas. El brochure ya no afirma que no hay departamentos construidos solo por estar en lanzamiento. El control final comprueba destinos autorizados, manteniendo la distinción entre departamento modelo y unidades terminadas.

## Archivos

- `src/app/inmobiliaria/automatizacion/proyecto/page.tsx` y `actions.ts`: acceso administrativo, lectura y guardado con control de concurrencia.
- `src/components/inmobiliaria/automation/ProjectReadinessSettings.tsx` y `.module.css`: interfaz nueva.
- `AutomationSectionTabs.tsx`, `AutomationSettings.tsx`, `BotVisitSettings.tsx`: navegación y enlace desde los controles anteriores.
- `src/lib/inmobiliaria/projectReadiness.ts`: validación, reglas, materiales autorizados e invitaciones; `botVisits.ts`: política de visitas compatible con la configuración anterior.
- `src/lib/integrations/automation/conversation.ts`, `sales-policy.ts`: aceptación contextual y coordinación.
- `direct-conversation-rule.ts`, `tone-settings.ts`: regla transversal de pregunta explícita.
- `sdr.ts`, `turn-completeness.ts`, `commercial-experience.ts`, `project-material.ts`: contexto físico y redacción comercial.
- `visit-copy.ts`, `visit-location.ts`, `visit-rules.ts`, `visits.ts`: destinos y mensajes de cita.

Datos guardados en `projects.policies_json.project_readiness`, con historial de los últimos 20 cambios. Se preservan las demás claves; un guardado concurrente se rechaza para evitar sobrescribir otra configuración. No requiere SQL manual ni altera conversaciones existentes.

Pruebas: `scripts/project-readiness.test.cjs`, regresiones de integraciones, rutas de visitas y tonos. No se envían mensajes reales durante las pruebas. La validación de documentos de identidad no forma parte de esta entrega.
