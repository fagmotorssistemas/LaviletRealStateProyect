# Entrega final Schedule web + WhatsApp (candidatos locales)

**Sin push** a `feat/meta-schedule-aceptar-cita`: Vercel Preview se dispara en cada push de esa rama. Commits locales listos; publicar solo cuando se autorice.

## SHA finales (código) — commits locales, **sin push** (evita Preview Vercel)

| Pieza | Rama | SHA |
| --- | --- | --- |
| Frontend | `feat/meta-schedule-aceptar-cita` | `2aa342344665fcf6dd2a84682359b9e7904d57b6` |
| Nest | `fix/supabase-drain-exclude-review-hold` | `e076f5a5eb698a418eb6f03c0fbd8686f6e21d43` |

Diff local vs remoto: FE tip no publicado; Nest `ahead 1` sin push.

PR frontend existente: **#5** — https://github.com/fagmotorssistemas/LaviletRealStateProyect/pull/5 (no duplicar).  
Nest: abrir/actualizar PR a `main` desde la rama Nest si aún no existe (no create FE duplicate).

---

## 1. Schedule web — estado

| Capacidad | Estado |
| --- | --- |
| Confirmación cliente + consent + canal web | Listo (elegibilidad) |
| Intent durable inmutable | Listo (`lv_register_meta_schedule_intent`) |
| Outbox `review_hold` → promote `pending` | Listo; delivery-only promote tras recover |
| Flush FE + drain Nest | Listo (flags) |
| Payload Graph `Schedule` + `website` | Listo; test HTTP interceptado (mock) |
| Recover pre-intent + concurrencia 2 conex. | Listo (DB aislada) |
| Dedupe `schedule:{id}` | Listo |
| Revocación cancela `review_hold` | Listo (`17180000` + FE cancel) |
| Controles OFF → cero escrituras | Listo |
| Permisos service_role | Listo |

**Nota de canal:** el evento website solo dispara si `appointments.channel` es `web`/`website` y `confirmed_by_client`. Citas del bot con `channel=whatsapp` **no** se remapean a website.

---

## 2. WhatsApp / BM Schedule — bloqueo externo Meta

### Evidencia oficial

Fuente: [Conversions API for Business Messaging](https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging/)

- Requiere: Cloud API (o On-Prem ≥2.45.1), `dataset_id` del WABA, `ctwa_clid`, `whatsapp_business_account_id`, `action_source=business_messaging`, `messaging_channel=whatsapp`.
- Ejemplos de `event_name` en la documentación: **Purchase**, **LeadSubmitted**, etc.
- **`Schedule` no figura** en el contrato BM documentado.
- Comunidad / integradores: Graph **subcode 2804066** — *Invalid event type for messaging event* para nombres fuera del allowlist (incluye Schedule). Allowlist reportada incluye p. ej. `AppointmentBooked`, `LeadSubmitted`, `Purchase` — **no** Schedule.

### Decisión de producto (esta entrega)

| Opción | Hecho |
| --- | --- |
| Enviar Schedule como `website` | **No** (cambia canal / significado) |
| Renombrar a `AppointmentBooked` | **No** (cambia el event_name; fuera de alcance sin decisión de negocio) |
| Enviar Schedule BM | **Bloqueado** en FE (`needs_review`), recover SQL, Nest enqueue/drain |

### Acción concreta para desbloquear (externa)

1. Decisión de negocio: ¿mapear la cita WhatsApp a un `event_name` BM admitido (p. ej. `AppointmentBooked`) **sin** llamarlo Schedule, o mantener solo medición web?
2. Si se aprueba un event_name BM: implementar payload BM completo + dataset messaging + WABA + ctwa; **no** usar pixel web.
3. Mientras tanto: mantener bloqueo; atender y confirmar citas **sin** exigir CTWA.

### Kommo / ctwa / WABA / dataset (independiente del bloqueo Schedule)

| Elemento | Cómo | Bloquea cita? |
| --- | --- | --- |
| `ctwa_clid` | Opcional desde webhook Kommo; first-touch en `lv_whatsapp_ctwa_attribution` | **No** |
| Evidencia Kommo real | Pendiente de **un** webhook genuino desde anuncio CTWA (sin fabricar) — docs `CTWA_KOMMO_CRM.md` | No |
| WABA | Env `META_WABA_ID` | Solo medición BM |
| Messaging dataset | Env `META_MESSAGING_DATASET_ID` (≠ pixel) | Solo medición BM |

---

## 3. Migraciones (orden exacto)

1. `20260917152000_meta_capi_outbox_review_hold.sql`
2. `20260917160000_meta_schedule_recovery.sql`
3. `20260917170000_meta_schedule_recover_pre_intent.sql`
4. `20260917180000_meta_schedule_consent_cancel_review_hold.sql`

---

## 4. Variables por entorno

### Defaults post-deploy (todos los entornos)

| Variable | FE | Nest | Valor |
| --- | --- | --- | --- |
| `META_SCHEDULE_LOCAL_PERSIST` | ✓ | | unset/`false` |
| `META_SCHEDULE_RECOVER_ENABLED` | | ✓ | unset/`false` |
| `META_SCHEDULE_DELIVERY_ENABLED` | ✓ | ✓ | unset/`false` (**ambos** alineados) |
| `META_SCHEDULE_FLUSH` | ✓ | | unset/`false` |
| `META_MODE` / dataset / Pixel / CAPI secrets | existentes | existentes | **sin cambio** |
| `META_WABA_ID` / `META_MESSAGING_DATASET_ID` | opc. | vía payload | solo si se activa BM no-Schedule en el futuro |

### Activación Schedule **web** (solo tras migración + deploy)

1. Flags OFF + health Lead/VC OK  
2. `META_SCHEDULE_RECOVER_ENABLED=true` (Nest) — opcional test  
3. `META_SCHEDULE_LOCAL_PERSIST=true` (FE)  
4. `META_SCHEDULE_DELIVERY_ENABLED=true` (FE **y** Nest)  
5. `META_SCHEDULE_FLUSH=true` (FE)  
6. Verificar 1ª cita genuina web+consent (SQL lectura; sin fabricar) → Events Manager dataset **web**

WhatsApp Schedule: **no** activar envío.

---

## 5. Reversión operativa

1. Cuatro flags Schedule → `false`  
2. Restaurar código a SHA previo si hace falta  
3. Conservar esquema y datos outbox/intent/CTWA  
4. **No** ejecutar `down.sql` de `17160000` (DROP columnas intent)

---

## 6. Pruebas

| Tipo | Comando | Alcance |
| --- | --- | --- |
| Unit FE | `npm run test:meta-schedule` | Local simulado |
| Build FE | `npm run build` | Local |
| DB aislada | `npm run test:meta-schedule-recover-db` | RPC/migraciones/concurrencia/consent — **no** Meta |
| Nest | jest drain + BM gates + `schedule-web-graph.intercept.spec.ts` | HTTP Graph **interceptado** (mock) |
| Recepción real Meta | — | **No** en esta entrega |

---

## 7. Fuera de alcance

Campañas, publicaciones, merge, migraciones Production, eventos Graph reales, Preview por push no autorizado, Pixel/CAPI Lead·VC contract changes.
