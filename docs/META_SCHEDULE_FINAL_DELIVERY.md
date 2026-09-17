# Entrega final Schedule web + WhatsApp (candidatos locales)

**Sin push** a `feat/meta-schedule-aceptar-cita`: Vercel Preview se dispara en cada push de esa rama. Commits locales listos; publicar solo cuando se autorice.

## SHA finales (código) — commits locales, **sin push** (evita Preview Vercel)

| Pieza | Rama | SHA |
| --- | --- | --- |
| Frontend | `feat/meta-schedule-aceptar-cita` | `c8f802a83c1c7b60a47914b0bae9887b52651608` (tip local; código `2aa3423…`) |
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

Ver evidencia y lista FAQ oficial + promote Nest en:  
[`META_SCHEDULE_WA_AND_PROMOTE_CLARIFICATIONS.md`](./META_SCHEDULE_WA_AND_PROMOTE_CLARIFICATIONS.md)

Resumen: **`Schedule` no está en la lista FAQ oficial de eventos BM**; envío bloqueado.  
`AppointmentBooked` **no** se propone (ausente en esa FAQ; compatibilidad no confirmada).  
Subcódigo **2804066**: procedencia foro Meta (rechazo de nombre BM inválido); no hay POST Graph real de Schedule en esta entrega.

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
