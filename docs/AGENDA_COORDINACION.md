# Coordinación de visitas (Agenda + layout)

La ruta sigue siendo `/inmobiliaria/agenda`. No hay un módulo paralelo de citas.

Supabase es la fuente de verdad. Kommo es la vista operativa de las asesoras. n8n envía WhatsApp. El frontend no llama a Kommo ni a WhatsApp.

Zona horaria: `America/Guayaquil`. Instalación: `docs/AGENDA_INSTALL.md`.

## Autorización

`is_admin()` comprueba `profiles.role = 'admin'` y **no** tenant ni proyecto. En La Vilet el admin es global. No existe tabla de pertenencia a proyecto; no se inventó.

Citas visibles: admin, responsable, o propuesta abierta asignada a esa persona. `responsible_id IS NULL` no expone otros proyectos.

## Migraciones (no aplicadas en producción desde el agente)

1. `20260907180000_agenda_visits.sql` — confirmación manual, `meeting_place`, asistencia. Sin `USING (true)` y sin gist.
2. `20260907210000_agenda_coordination.sql` — holds, RPCs, RLS, jornada La Vilet, SLA de revisión 90. Índice de holds **sin** `WHERE expires_at > now()`.
3. `20260907220000_agenda_no_overlap.sql` — gist; se detiene si hay solapes. No modifica citas.

Chequeos en RPC cubren creación/edición manual, propuestas, holds y confirmación del bot. El gist es adicional y va aparte.

## Reparto

`lv_assign_appointment_fairly` ignora el array de candidatos. Cuenta `count(DISTINCT appointment_id)` en historial del bot. Reprogramación adopta al responsable y **no** inserta historial. Contrapropuesta conserva asesor. Citas manuales no entran al contador.

Bloqueo unificado: `lv_lock_project` (advisory tenant:proyecto) **antes** de `FOR UPDATE` de propuesta y cita.

## Escalamiento

`lv_escalate_overdue_requests` solo `awaiting_advisor` con `escalation_due_at <= now()`. No usa `reviewed_at` (abrir el detalle no cuenta). `awaiting_client` no escala. Contrapropuesta reinicia 90 minutos. Sin `EXCEPTION WHEN OTHERS`. Sin responsable: evento `coordination_followup` y visible a coordinación.

## Outbox

Un productor de confirmación: `lv_confirm_visit_from_request`. Agenda manual no encola `visit_confirm`. `visit_2h` se pausa con propuesta abierta; al resolver, el planificador puede insertar el nuevo `start_time` sin reactivar filas `cancelled`.

`visit_propose` en `lv_outbox_event_is_current` no exige cita confirmada.

Plantillas generales: el consumidor debe respetar la ventana de WhatsApp. No hay ruta de plantilla aprobada en este repo.

## Contratos RPC n8n (service_role salvo UI)

### `lv_intake_visit_request`

| Parámetro | Tipo |
| --- | --- |
| `p_lead_id` | uuid |
| `p_project_id` | uuid |
| `p_preferred_time_text` | text, default null |
| `p_start_time` | timestamptz, default null |
| `p_end_time` | timestamptz, default null |
| `p_source_message_id` | text, default null |
| `p_source_message_text` | text, default null |

Retorna `uuid` (appointment_id). Reintento del mismo `source_message_id` devuelve la cita existente.

### `request_visit(p_lead_id uuid, p_project_id uuid, p_preferred_time_text text, p_start_time timestamptz)`

Envoltorio del intake **sin** `source_message_id`. Solo service_role (se revoca PUBLIC/anon/authenticated).

### `lv_intake_reschedule_request(p_appointment_id uuid, p_preferred_time_text text, p_start_time timestamptz, p_end_time timestamptz, p_source_message_id text, p_source_message_text text)`

Retorna `uuid` (appointment_id). Adopta responsable; no suma contador.

### `lv_client_counterpropose(p_previous_request_id uuid, p_start_time timestamptz, p_end_time timestamptz, p_preferred_time_text text, p_source_message_id text, p_source_message_text text)`

Retorna `uuid` (nuevo request_id). Conserva asesor. Nuevo `escalation_due_at`.

### `lv_client_accept_request(p_request_id uuid, p_message_id text)`

Retorna `appointment_reschedule_requests`. `p_message_id` = `messages.id` o `external_message_id` de un inbound `role = 'cliente'` del mismo lead/tenant/proyecto/canal. Idempotente.

### `lv_escalate_overdue_requests()` → integer

### `lv_outbox_event_is_current(p_outbox_id uuid)` → boolean

### `lv_release_expired_holds()` → integer

### UI (authenticated; validan dentro)

`lv_mark_request_reviewed(uuid)`, `lv_advisor_accept_request(uuid)`, `lv_advisor_propose_request(uuid, timestamptz, timestamptz, text)`, `lv_request_reassignment(uuid, text)`, `lv_reject_request(uuid, text)`, `lv_reassign_bot_appointment(uuid, text, uuid[])` (solo si `is_admin()`), `confirm_appointment`, `create_confirmed_appointment`, asistencia, cancelar.

No EXECUTE para authenticated: `lv_confirm_visit_from_request`, `lv_client_accept_request`, auxiliares SECURITY DEFINER (`lv_upsert_hold`, `lv_lock_project`, `lv_assert_client_inbound_message`, …).

## Payload `lv_outbox`

Campos comunes: `detail`, `text`, `location`, `request_id`, `appointment_id`, `kind`, `start_time`, `end_time`, `advisor_id`, `lead_id`.

### `visit_propose`

Encola cuando el asesor acepta un hueco y el cliente aún no, o cuando propone alternativa. `lv_outbox_event_is_current`: propuesta `awaiting_client`, no vencida, asesor elegible, jornada, sin conflicto. **No** exige cita `aceptado`.

Texto: `Podemos recibirle {lv_format_visit_when}. Será un gusto mostrarle el proyecto. ¿Le viene bien ese horario?`

### `visit_confirm`

Solo desde `lv_confirm_visit_from_request` (cita nueva). Texto:

```
Perfecto, Carlos. Le esperamos el martes 8 de septiembre a la 1 p. m. con Freddy Javier, de nuestro equipo. Será un gusto recibirle y mostrarle el proyecto. Aquí puede ver nuestra ubicación:
https://maps.app.goo.gl/cjkNv7c4siehTqAN9
Si necesita alguna indicación, puede escribirnos por aquí. ¡Muchas gracias!
```

Sin “mañana”. Sin puntuación después del enlace. `a la 1` / `a las 2`.

### `visit_reschedule_confirm`

Igual que confirmación, `kind` distinto, cita `reprogramado`.

## Kommo (solo documentación)

Campo coordinación `519824`. Recordatorio `513120`. Salesbots: propuesta `18724`, confirmación `18730`, visit_2h `18350`. Permanecen en HTTP Request de n8n.

## Pendiente n8n

JSON no está en el repo. No está cableado ni probado. Hoy el enviador conocido es `visit_2h`. Hay que: llamar intake/accept; no duplicar `visit_confirm`; consumir los tres kind con `lv_outbox_event_is_current`; cron de holds/escala; respetar ventana de WhatsApp.

## Verificado / no verificado

Verificado en este repo: tests de reparto 10/10 y 10/10/10, reloj/copy, horas por defecto, SQL leído contra el proyecto vivo (políticas USING true, `is_admin` global, solape de las dos citas, funciones de coordinación **ausentes**).

No verificado: aplicar migraciones, RPC contra Postgres aislado, concurrencia real, n8n, envío WhatsApp, RLS con sesiones de asesor. No se afirma que “no se rompe nada”.
