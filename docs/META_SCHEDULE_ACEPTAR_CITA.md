# Schedule Meta ↔ «Aceptar cita» (revisión)

Estado: **evaluación preparada; cola activa separada**. Sin persistencia outbox, sin flush Nest, sin eventos reales.

## Hallazgo del flujo «Aceptar cita»

| Pregunta | Respuesta |
| --- | --- |
| ¿Dónde está el botón? | `AppointmentSummary` → `AppointmentDetailModal.handleAcceptRequest` |
| ¿Confirmación definitiva? | Con `can_accept`: un clic → request `confirmed`, cita `aceptado`/`reprogramado` |
| ¿Propuesta? | Sin evidencia de cliente → `awaiting_client` (aún no definitiva; **sin** Schedule) |
| Consent ads | **No** se asume por aceptar la cita (`leads.meta_ads_consent === true` requerido para negocio OK) |

## Separación evaluación / cola

| Capa | Responsabilidad |
| --- | --- |
| Evaluación | `evaluateScheduleForConfirmedAppointment` + gancho `notifyScheduleIfRequestConfirmed` |
| Cola activa | **Desconectada** (`queueable: false`). `enqueueSchedule…` no escribe outbox ni envía |

### WhatsApp

- `action_source` previsto: `business_messaging` (nunca `website`).
- **Eso no completa la integración.** Entrega: `whatsapp_delivery_pending_nest_contract` hasta verificar el contrato completo Nest/Meta.
- No encolar ni flushear Schedule WhatsApp en esta revisión.

### Web

- Intención `website`, pero razón `evaluation_ok_queue_inactive` (cola separada).

## Gancho en agenda

Tras save exitoso en **server actions** (`agenda/actions.ts`): `acceptClientVisitTimeAction` / `advisorAcceptRequestAction` solo si `status === 'confirmed'`; `confirmAppointmentAction` tras confirmación. Propuestas y errores RPC **no** evalúan. El service compartido no importa Meta (evita `server-only` en el cliente).

## Pruebas

```bash
npm run test:meta-schedule
npm run build
```

Cubre: propuesta excluida, confirmación incluida, fallo de guardado sin evento, WhatsApp pending Nest, cola inactiva.

## Fuera de alcance

- Activar outbox / flush / Pixel Schedule.
- Cerrar contrato Nest/Meta para WhatsApp.
- Production, citas ficticias o mensajes reales.
