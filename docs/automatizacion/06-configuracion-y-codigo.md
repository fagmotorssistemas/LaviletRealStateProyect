# Configuración y mapa del código

## Pantallas

| Pantalla | Ruta | Función |
| --- | --- | --- |
| Monitoreo | `/inmobiliaria/automatizacion` | Leads, indicadores y citas pendientes. |
| Flujo visual | `/inmobiliaria/automatizacion/workflow` | Arquitectura y ejecuciones recientes. **Local pendiente.** |
| Reglas y SLA | `/inmobiliaria/automatizacion/reglas` | Horarios, equipo, citas, puntuación y seguimientos. |
| Guion | `/inmobiliaria/automatizacion/guion` | Preguntas y comportamiento por modo comercial. |
| Estado del proyecto | `/inmobiliaria/automatizacion/proyecto` | Estado físico, lugares visitables y materiales. |
| Estilo | `/inmobiliaria/automatizacion/estilo` | Tono y personalidad de conversación. |
| Modo de pruebas | `/inmobiliaria/automatizacion/pruebas` | Lead autorizado y retraso reducido. |
| Precios | `/inmobiliaria/automatizacion/precios` | Valores publicados y visibilidad en lanzamiento. |
| Ubicación | `/inmobiliaria/automatizacion/ubicacion` | Dirección y enlace de mapa. |

Las pantallas administrativas requieren rol `admin`. El middleware también puede limitar rutas mediante `crm_paths`.

## Controles de ejecución

### Variables de entorno

| Variable | Uso |
| --- | --- |
| `AUTOMATION_MODE` | `off`, `preview` o `live`. |
| `AUTOMATION_ACTIVATED_AT` | No procesa mensajes anteriores a esta activación. |
| `AUTOMATION_N8N_DISABLED` | Debe ser `true` para habilitar el ejecutor propio en vivo. |
| `AUTOMATION_TEST_LEAD_ID` | Limita el servidor a un lead específico. |
| `AUTOMATION_GLOBAL_MAINTENANCE` | Habilita mantenimiento global y decaimiento cuando no hay modo de prueba. |
| `KOMMO_WEBHOOK_SECRET` | Autoriza el webhook. |
| `AUTOMATION_CRON_SECRET` / `CRON_SECRET` | Autoriza el worker. |

### Base de datos

`lv_auto_config` añade controles operativos:

- `enabled`;
- `dry_run`;
- `test_only`;
- `test_lead_id`.

La restricción del servidor es la autoridad. Aunque las columnas conservan los nombres heredados `test_only` y `test_lead_id`, la configuración productiva actual las utiliza como una lista permitida de un solo lead: Carlos (`0987110032`). El ejecutor está en vivo y sin `dry_run`, pero cualquier otro contacto queda bloqueado y se refleja con `DETENER IA=true` en Kommo. El bloqueo existe aunque esa escritura remota falle.

La pantalla `Reglas y SLA > Seguimiento` lee y guarda los pasos reales en `projects.policies_json`. El detalle del lead consulta los trabajos actuales de `lv_integration_events` y muestra su fecha, estado y motivo. Las tablas históricas `nutrition_steps`, `lead_nutrition` y `nutrition_delivery_history` permanecen intactas para compatibilidad y no se presentan como fuente operativa.

El webhook de la aplicación debe estar suscrito en Kommo a `add_message` y `add_outgoing_message`. El primero alimenta los mensajes del lead; el segundo permite detectar una respuesta manual del asesor. Sin la segunda suscripción, una contestación escrita directamente en Kommo no puede pausar la IA.

## Identificadores de Kommo

| Uso | Identificador |
| --- | --- |
| Cuenta Kommo aceptada | `36919007` |
| Campo de respuesta IA | `457014` |
| Campo `DETENER IA` | `451530` |
| Salesbot de respuesta general | `15578` |
| Salesbot de recordatorio 2 h | `22246` |
| Campo Saludo La Vilet | `531808` |
| Campo Detalle de cita La Vilet | `531120` |
| Campo Ubicación La Vilet | `531812` |

## Mapa de módulos

| Módulo | Responsabilidad |
| --- | --- |
| `webhook.ts` | Normalizar y validar eventos entrantes. |
| `worker.ts` | Reclamar eventos, bloquear concurrencia y ejecutar tareas. |
| `conversation.ts` | Orquestar permisos, contexto, rutas, validación y entrega. |
| `business-scope.ts` | Clasificar alcance inmobiliario. |
| `conversation-rules.ts` | Normalizar la salida del extractor y validar evidencia. |
| `turn-routing.ts` | Detectar rutas directas de conversación y visita. |
| `sdr.ts` | Construir contexto y respuesta comercial. |
| `price-reply.ts` | Cotizaciones y orientación por presupuesto. |
| `unit-alternatives.ts` | Recomendar alternativas reales. |
| `unit-model.ts` | Entregar tour de unidad o tour general. |
| `visits.ts` | Planificar y enviar mensajes operativos de citas. |
| `visit-intake.ts` | Recopilar fecha, hora y lugar. |
| `visit-rules.ts` | Revalidar propuestas, confirmaciones y recordatorios. |
| `visit-reminder.ts` | Crear las tres variables del recordatorio de dos horas. |
| `financing.ts` | Consentimiento, entidad y estado financiero. |
| `financing-continuation.ts` | Interpretar respuestas al siguiente campo pendiente. |
| `nutrition*.ts` | Programar, validar y enviar seguimientos. |
| `human-attention.ts` | Determinar si el asesor posee la conversación actual. |
| `advisor-outbound.ts` | Registrar la toma de control manual, pausar la IA y cancelar seguimientos. |
| `kommo.ts` | Leer/escribir campos y lanzar Salesbots. |
| `execution-trace.ts` | Registrar pasos sanitizados para Workflow. **Local pendiente.** |

## Tablas y RPC principales

| Recurso | Uso |
| --- | --- |
| `lv_integration_events` | Cola idempotente de entradas y mantenimiento. |
| `leads` | Estado, temperatura, preferencias, permisos y asignación. |
| `conversations` / `messages` | Historial y memoria. |
| `advisor_notifications` | Notificaciones privadas de asignación por asesor. |
| `units` / `unit_prices` | Inventario y precios. |
| `project_automation_config` | Horarios, modo comercial, SLA y umbrales. |
| `lead_scoring_rules` / `lead_score_events` | Reglas y hechos de puntuación. |
| `appointments` / `appointment_reschedule_requests` | Citas y coordinación. |
| `lv_visit_intakes` | Datos parciales de una visita. |
| `financing_prequalifications` | Progreso financiero. |
| `project_financing_partners` | Entidades publicables. |
| `lv_outbox` | Entregas operativas y estados inciertos. |
| `project_area_facts` | Hechos verificados del sector. **Código consumidor local pendiente.** |
| `lv_automation_execution_steps` | Trazabilidad visual. **Código escritor local pendiente.** |

RPC relevantes:

- `lv_app_receive`
- `lv_app_claim`
- `lv_app_finish`
- `register_inbound_message`
- `register_outbound_message`
- `lv_app_conversation_context`
- `apply_lead_events`
- `save_lead_declarations`
- `handoff_lead`
- `lv_collect_visit_intake`
- `process_financing_message_v2`

## Estado de los cambios locales al 20 de septiembre de 2026

Estos grupos están en el espacio de trabajo y no deben confundirse con cambios ya publicados:

1. Workflow visual con React Flow y trazabilidad de ejecuciones.
2. Hechos positivos de Puertas del Sol y recomendación de local según ubicación y capital.
3. Enlaces dinámicos al tour general o a la unidad, en lugar de fotos de galería.
4. Horarios de atención antes de pedir fecha y mejores respuestas para días cerrados.
5. Reflejo de `DETENER IA=true` para leads distintos del lead de prueba.
6. Pruebas y migraciones relacionadas con esos cambios.

La recuperación de días 30 y 60, el estado de seguimiento separado y la limpieza de nombres heredados de etapas siguen planificados.
