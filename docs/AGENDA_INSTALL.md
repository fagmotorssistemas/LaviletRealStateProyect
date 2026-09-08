# Instalación de coordinación de citas

No aplicar ni desplegar en producción desde el agente. Cada archivo de migración de Supabase corre en **una transacción**: si falla, ese archivo no queda a medias. No encadenar 180000+210000+220000 en un script que ignore errores.

## Orden exacto

1. Lectura: `supabase/scripts/agenda_install_precheck.sql`
2. Lectura: `supabase/scripts/agenda_overlap_blockers.sql`
3. `supabase/migrations/20260907180000_agenda_visits.sql`
4. `supabase/migrations/20260907210000_agenda_coordination.sql`
5. Decisión humana sobre el solape existente (no la toma la migración)
6. Solo si el paso 2 / `lv_appointment_overlap_blockers()` está vacío: `supabase/migrations/20260907220000_agenda_no_overlap.sql`

Reversiones, en sentido inverso: `20260907220000_agenda_no_overlap_down.sql`, `20260907210000_agenda_coordination_down.sql`, `20260907180000_agenda_visits_down.sql`. El down de visitas **no borra** `appointment_reschedule_requests`.

## Qué cambia 210000 en La Vilet (solo ese proyecto)

Tenant `a1b2c3d4-0001-4000-8000-000000000001`, proyecto `b1b2c3d4-0001-4000-8000-000000000001`:

- Zona `America/Guayaquil`
- Lun–vie 08:30–18:30, sábado 09:30–13:30, domingo cerrado
- `review_sla_minutes = 90`
- `visit_location_url` si estaba vacío

**No** reescribe `sla_response_minutes` (handoff, hoy 120). `business_hours` también lo lee `is_project_open`: al instalar, el handoff de La Vilet pasa a esa jornada. Otros proyectos no cambian horario.

Visitas: duración exacta 60 minutos (último inicio 17:30 / 12:30).

## Autorización

`is_admin()` = `profiles.role = 'admin'`. No comprueba tenant ni proyecto. En este proyecto hay un solo tenant; el administrador es **global**. No hay tabla de pertenencia de admin a proyecto.

RLS de citas: admin, o `responsible_id = auth.uid()`, o propuesta abierta asignada a esa persona. `responsible_id IS NULL` **no** abre todas las citas de todos los proyectos.

`project_salespeople`: se retiran `Authenticated all` / `Authenticated read` con `USING true`. SELECT de compañeros del mismo proyecto (dropdown de Agenda). Escritura solo admin.

Consumidores: Agenda, inbox, `listProjectAdvisors`, Reglas (admin), citas del lead. Un asesor deja de ver visitas de otro en el mismo lead.

## Solape existente (no modificar)

`responsible_id = 23967847-e265-4c8b-ab0c-8c4e6c56008c`

| id | inicio UTC | fin UTC | estado |
| --- | --- | --- | --- |
| 38c751bf-0b78-42ea-8e4c-29b7723b90ac | 2026-07-09 23:25 | 2026-07-10 00:25 | aceptado |
| 5c5951ea-0a86-4d62-9628-2faaefb88a3a | 2026-07-09 23:45 | 2026-07-10 00:45 | aceptado |

Solape ~18:45–19:25 America/Guayaquil el 2026-07-09. Ambas `scheduled_by = asesor`. Bloquean `appointments_responsible_no_overlap` (EXCLUDE gist `tstzrange(start_time,end_time,'[)')` en pendiente|aceptado|reprogramado).

180000/210000 instalan chequeo en RPC (citas, propuestas, holds, confirmación). **No** instalan el gist. 220000 se detiene con `RAISE EXCEPTION` si sigue habiendo pares; no borra ni mueve esas citas.

## Productor de confirmación

Solo `lv_confirm_visit_from_request` inserta `visit_confirm` / `visit_reschedule_confirm`. `confirm_appointment` / `create_confirmed_appointment` (Agenda manual) no encolan Salesbot. `lavilet_due_reminders` solo planifica `visit_2h` y se pausa con propuesta abierta.

## WhatsApp

Las plantillas generales tienen ventana de atención. El consumidor de `lv_outbox` debe impedir un envío general fuera de ventana. Si hay una ruta de plantilla aprobada, usarla; **no está en este repositorio** y no se afirma que exista.

## n8n (contratos; JSON no está en el repo)

No se modificó ni probó ningún workflow. IDs de Kommo **solo aquí**, no en Supabase:

- Campo coordinación: `519824`
- Campo recordatorio: `513120`
- Salesbot propuesta: `18724`
- Salesbot confirmación: `18730`
- Salesbot recordatorio 2h: `18350`

Pendiente en n8n cuando haya canvas:

1. Captura: `lv_intake_visit_request` / `lv_intake_reschedule_request` / `lv_client_counterpropose` / `lv_client_accept_request`. Insertar el mensaje inbound **antes** de aceptar (la RPC exige `messages.role = 'cliente'`).
2. Dejar de insertar `visit_confirm` desde un planificador si la RPC ya lo encola.
3. Consumir `visit_propose`, `visit_confirm`, `visit_reschedule_confirm` con `lv_outbox_event_is_current(id)` antes de Salesbot.
4. Cron: `lv_release_expired_holds()` + `lv_escalate_overdue_requests()`.
5. `visit_2h` sin cambio de Salesbot; respeta pausa.
