# Schedule Meta ↔ «Aceptar cita» (revisión)

Estado: **implementación preparada para revisión**. Persistencia local y envío CAPI **desactivados** (`META_SCHEDULE_PERSIST` ≠ `true`). No se publican ni envían eventos reales.

## Hallazgo del flujo «Aceptar cita»

| Pregunta | Respuesta |
| --- | --- |
| ¿Dónde está el botón? | `AppointmentSummary` → modal agenda (`AppointmentDetailModal.handleAcceptRequest`) |
| ¿Qué guarda? | Con horario exacto del cliente: RPC `lv_accept_client_visit_time` → `lv_confirm_visit_from_request` |
| ¿Queda definitiva? | **Sí**, en un clic si `can_accept` (evidencia de cliente + disponibilidad): request `confirmed`, cita `aceptado`/`reprogramado`, `confirmed_by_client=true` |
| ¿Segunda aceptación? | Solo si el asesor acepta **sin** evidencia de cliente (`lv_advisor_accept_request`) → `awaiting_client` (propuesta); aún no es definitiva |
| Otro botón | «Confirmar cita» CRM (`confirm_appointment`) confirma sin outbox WhatsApp y con `confirmed_by_client=false` |

Aceptar la cita **no** implica consentimiento publicitario.

## Conexión Schedule (conservadora)

1. **Cuándo**: solo después de guardado exitoso que deja la cita en `aceptado` o `reprogramado` (gancho en `acceptClientVisitTime`, `advisorAcceptRequest` si `confirmed`, y `confirmAppointment`).
2. **Consentimiento**: exige `leads.meta_ads_consent === true`. `null`/`false` → no elegible. No se infiere del click.
3. **Canal**:
   - `appointments.channel = whatsapp` → `action_source: business_messaging` (**no** `website`)
   - `web` → `website`
   - desconocido → no elegible (`unknown_channel`)
4. **Dedupe**: `idempotency_key = schedule:{appointmentId}` (doble clic / recarga / reintento → misma clave).
5. **Modo revisión**: el gancho evalúa y registra solo `scope/code/reason` (sin horarios, lugar, teléfono ni nombre). **No** escribe outbox ni flushea Meta salvo `META_SCHEDULE_PERSIST=true` **y** persist explícito (no activar en Production en esta revisión).

Código: `src/lib/meta/scheduleEligibility.ts`, `src/lib/meta/scheduleIntegration.ts`, gancho en `src/services/inmobiliaria.service.ts`.

## Pruebas aisladas

```bash
npm run test:meta-schedule
```

Cubre: WhatsApp ≠ web, consent no asumido, solo estado confirmado, idempotency, persist off por defecto.

## Fuera de alcance (esta revisión)

- Activar `META_SCHEDULE_PERSIST` o flush CAPI / Pixel Schedule.
- Fabricar Schedule desde `/api/meta/enqueue` (sigue bloqueado).
- Incluir detalles personales de la cita en logs o custom data.
