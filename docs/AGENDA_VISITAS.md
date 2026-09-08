# Agenda: solicitudes, confirmación y asistencia

La ruta sigue siendo `/inmobiliaria/agenda`. No hay un módulo Citas.

`pendiente` se trata como solicitud del CRM que todavía necesita confirmación (junto con `solicitada` del bot). No se convirtió masivamente.

Confirmar una solicitud **no** pone `confirmed_by_client = true`. Ese campo solo aplica si hay evidencia de que el cliente confirmó.

## Instalación SQL (no aplicar en producción desde el agente)

Orden (detalle: `docs/AGENDA_INSTALL.md`):

1. `supabase/migrations/20260907180000_agenda_visits.sql`
2. `supabase/migrations/20260907210000_agenda_coordination.sql`
3. Decisión humana sobre citas solapadas
4. `supabase/migrations/20260907220000_agenda_no_overlap.sql` solo si no hay bloqueadores

La migración 180000 añade `appointments.confirmed_by`, `confirmed_at`, `meeting_place`; `appointment_change_log`; RPCs atómicas; y pausa `appointment_reminders_paused`. **No** recrea `appointment_reschedule_requests` ni políticas `USING (true)`.

El check real de `appointments.status` ya incluye `solicitada`. No se creó el estado `no_asistio`: la inasistencia usa `status = atendido` y `no_show = true`.

## Archivos principales

- UI: `src/app/inmobiliaria/agenda/page.tsx`, `AppointmentCard`, `AppointmentDetailModal`, `CreateAppointmentModal`, `AgendaVisitFields`, `LeadDetailAgendaTab`
- Hook: `src/hooks/inmobiliaria/useAgenda.ts` (pestañas `solicitudes | proximas | historial`, request id contra respuestas viejas)
- Acciones de sesión (no service_role): `src/app/inmobiliaria/agenda/actions.ts`
- Servicio/RPCs: `src/services/inmobiliaria.service.ts`
- Tipos: `src/types/inmobiliaria.ts`
- Zona Ecuador: `src/lib/inmobiliaria/agendaTime.ts`
- SQL: `supabase/migrations/20260907180000_agenda_visits.sql`

## Pestañas

| Pestaña | Qué entra | Fecha del filtro |
| --- | --- | --- |
| Solicitudes | `solicitada`, `pendiente`, y citas con cambio pendiente | `requested_at` |
| Próximas citas | `aceptado` / `reprogramado` **sin** cambio pendiente. Vencidas visibles, no se marcan inasistencia solas | `start_time` |
| Historial | `atendido` (con o sin `no_show`) y `cancelado` | `start_time`, o `requested_at` si no hay horario |

## Quién envía cada mensaje

El frontend **no** llama a Kommo ni a WhatsApp.

| Mensaje | Responsable | Estado |
| --- | --- | --- |
| Recordatorio `visit_2h` | n8n vía `lavilet_claim_reminder` / `lavilet_check_reminder` / `lavilet_finish_reminder` | Configurado |
| `visit_confirm`, 24 h, reagendamiento, seguimiento | n8n / Salesbots | **No asumir habilitados.** Hay filas `visit_confirm` en `lv_outbox`, pero solo `visit_2h` está cableado |
| Confirmación verbal/operativa en Agenda | Asesor en la UI | No genera WhatsApp |

Si otro flujo ya manda la confirmación al cliente, Agenda no debe enviar una segunda.

Etiquetas de `lv_outbox.status` (si se muestran en el futuro): `pending` pendiente; `accepted` Kommo aceptó la solicitud, no es entrega; `delivered` entrega confirmada; `uncertain` revisar; `cancelled` cancelado; `simulated` simulación.

## Pausa y reanudación de recordatorios

Contrato único para planificador y enviador:

`public.appointment_reminders_paused(appointment_id)` es verdadero si hay una propuesta abierta (`awaiting_advisor` o `awaiting_client`). Ver `docs/AGENDA_COORDINACION.md`.

- **Pausa:** no enviar. Dejar la fila `lv_outbox` en `pending`. No cancelarla: la unique de `dedupe_key` bloquearía el reenvío al reanudar.
- **Reanudar** (rechazo o resolución sin cambio de hora): la función vuelve a falso. El enviador puede usar la fila pending original si todavía está en ventana. No reactivar filas `cancelled`. No reenviar un `visit_2h` cuya ventana de 110–120 minutos ya pasó.
- **Cambio de horario aprobado o cita cancelada:** `cancel_pending_visit_outbox` cancela solo `pending` y reescribe `dedupe_key` a `…:cancelled:{id}` para no chocar con la unique. El planificador puede insertar el nuevo horario. No se altera `lv_visit_state.revision` desde Agenda.
- Un envío ya `claimed` no se cancela. `lavilet_check_reminder` falla si el `start_time` ya no coincide o si la cita está pausada.

### Cambio exacto requerido en n8n

Los Salesbot IDs y campos Kommo se quedan en los HTTP Request de n8n. No van a Supabase ni a los formularios.

1. **visit_2h (lavilet_*)**  
   Tras aplicar la migración, `lavilet_due_reminders` y `lavilet_check_reminder` ya respetan la pausa.  
   Si `lavilet_check_reminder` devuelve `valid = false`, marcar el recordatorio como `skipped` (no reintentar Salesbot). No hace falta mover IDs de Salesbot.

2. **Cualquier workflow que lea `lv_outbox`** (si existe; no está en este repo):  
   Antes de enviar, ejecutar `select public.appointment_reminders_paused(appointment_id)`.  
   Si es true: no enviar y no cambiar el status.  
   El planificador debe usar la misma función. No calcular `revision` distinto en el enviador.

3. **Bot WhatsApp / `request_visit`**  
   Sigue insertando `status = solicitada`. El bot no debe decir que la cita quedó confirmada.  
   Pedido de cambio: `insert` en `appointment_reschedule_requests` (unique de `source_message_id` evita duplicar el mismo mensaje). **No** sobrescribir `appointments.start_time` hasta que Agenda apruebe.

Este repositorio no incluye los JSON de n8n. La pausa de `visit_2h` queda en SQL; la de `lv_outbox` queda implementada en Postgres y documentada para n8n. No se verificó el canvas de n8n desde aquí.

## Prueba WhatsApp → Agenda

1. El lead pide visita por WhatsApp. El bot llama `request_visit` → fila `solicitada`, a menudo sin `start_time`.
2. En Agenda → Solicitudes debe verse con “Horario por confirmar”.
3. Confirmar cita exige fecha, horas, asesor del proyecto (no el usuario en silencio), lugar. Unidades opcionales.
4. Pasa a Próximas citas con `aceptado`, responsable y horario. `confirmed_by` / `confirmed_at` quedan registrados. `confirmed_by_client` sigue en false.
5. Un cambio pendiente no mueve el horario confirmado; la cita sale de Próximas y vuelve a Solicitudes.
6. Aprobar reprograma la misma cita (`reprogramado`) de forma atómica (`FOR UPDATE`).
7. Rechazar el cambio no cancela la cita.
8. Marcar asistió / no asistió usa `atendido` + `no_show`.
9. Los filtros de un día usan inicio inclusivo y el día siguiente exclusivo en `America/Guayaquil`.
10. Un asesor no ve citas de otro ámbito (filtro de `responsible_id` / proyectos asignados; las RPCs vuelven a comprobar).
11. Dos confirmaciones simultáneas: la segunda recibe “La solicitud ya fue confirmada”.
12. Unidades y cita se guardan en la misma RPC; un fallo no deja la cita a medias.

## Qué está probado aquí

- Tests de zona y rangos: `npm run test:automation` incluye `src/lib/inmobiliaria/agendaTime.test.ts`.
- Tipos, servicios, acciones y UI del módulo Agenda.

## Qué depende de integración externa

- Aplicar la migración en el entorno (no se aplicó a producción desde esta implementación).
- Flujo real WhatsApp → `request_visit` / insert de reprogramación.
- Canvas n8n (Salesbots, `lv_outbox` planner/sender). `visit_2h` queda cubierto en SQL tras migrar; el resto no está verificado.
- Doble clic concurrente real contra Postgres (el `FOR UPDATE` está en las RPCs; no se ejecutó un test de carga).
