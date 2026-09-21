# Procedimiento único — WhatsApp LeadSubmitted (despliegue y activación)

Documento operativo. **No activa conversiones por sí solo.**  
Flags default OFF. Un mensaje WhatsApp cualquiera **no** dispara LeadSubmitted.

Estados del trabajo (actualizar al ejecutar):

| Estado | Significado |
| --- | --- |
| **Preparación local completada** | Código + tests Nest con Graph simulado + CRM local + migraciones demo fuera del path prod |
| **Despliegue pendiente** | Push/deploy/migraciones remotas **no** hechos en esta entrega |
| **Validación CTWA real pendiente** | Sin evidencia de que Kommo entregue `ctwa_clid`; 0 filas en atribución prod |
| **Activación de conversiones pendiente** | Flags OFF; no envíos Meta BM reales autorizados aquí |

### Consentimiento WhatsApp ads (operativo)

**Cómo se ejecuta `lv_set_whatsapp_meta_ads_consent` hoy**

- **No hay pantalla CRM** ni acción de asesor para registrar este consentimiento.
- Se reconoce **automáticamente** cuando llega un mensaje **del cliente** por WhatsApp (webhook Kommo → `processConversation` / evaluación fuera del bot) y el texto coincide con aceptación **explícita** de medición/publicidad **Meta** (alcance `whatsapp_ads`).
- Cadena: mensaje entrante → `applyWhatsappAdsConsentFromClientMessage` → RPC `lv_set_whatsapp_meta_ads_consent` (evidencia: mensaje + fecha + scope).
- Frases genéricas («acepto publicidad») **no** conceden. Hace falta mención de Meta / Facebook / Instagram / medición publicitaria / datos para anuncios.
- `tracking_consent`, cookies y casilla de contacto del showroom **no** sustituyen este alcance.

El cliente debe escribir algo inequívoco, p. ej. *«Acepto que usen mis datos para medición publicitaria de Meta»*.  
No se envían mensajes automáticos del bot para pedirlo en esta entrega.

### Llegada tardía de consentimiento o CTWA

- Un turno **nuevo** con interés comercial puede encolar si ya hay evidencia + CTWA scoped.
- No hay backfill de saludos ni de mensajes históricos.
- Sin CTWA/consent no se sella `meta_wa_lead_submitted_event_id` (permite reintento real).

---

## Inventario por repositorio

### A) Frontend — `LaviletRealStateProyect` (`d:\La Vilet\frontend`)

| Pieza | Acción en despliegue |
| --- | --- |
| Eval/bloqueo FE (`waLeadSubmitted*`) | Ya en `main`; flags OFF |
| Bitácora `/inmobiliaria/marketing/capi` | Scope tenant; stages distintos de Meta |
| CTWA webhook→`lv_app_preserve_ctwa` | Schema prod ya aplicado (`20260916220000`); app en código |
| `20260918120000_meta_wa_lead_submitted.sql` | **Aplicar solo con autorización** (archivo único; no `db push` masivo) |
| `supabase/local-only/*` | **Nunca** a Production (demo auth/profiles) |
| Vars Vercel / FE | `META_WA_LEAD_SUBMITTED_ENABLED`, `META_WA_LEAD_SUBMITTED_DELIVERY_ENABLED` = `false` hasta activación; `META_WABA_ID`, `META_MESSAGING_DATASET_ID` |

### B) Backend — `backend-La-Vilet` (`d:\La Vilet\lavilet-meta-capi`)

| Pieza | Acción en despliegue |
| --- | --- |
| Gates BM + lane WA + consent estricto | Código Nest |
| Outbox claim excluye LS si delivery OFF | Conserva pending |
| Vars Nest | `META_WA_CAPI_ACCESS_TOKEN` (no web), `META_WA_LEAD_SUBMITTED_DELIVERY_ENABLED=false`, `META_API_VERSION=v21.0` (web sin cambio global) |
| Allowlist eventos | `ViewContent\|Lead\|Schedule\|LeadSubmitted` — **sin** `TestEvent` |

IDs verificados (destino BM):

- WABA: `1410020224338488` (solo `user_data.whatsapp_business_account_id`)
- Dataset mensajería: `4419657838288963` (URL Graph)
- Pixel web: `923439043758658` — **nunca** fallback BM

Nota API: sonda aislada usó `v26.0` + `TestEvent` (fuera de Nest). Nest envía BM en **`v21.0`**. Esa diferencia **no** se asume causa del rechazo histórico ni justifica cambiar el envío web global.

---

## Mecanismo real de despliegue (verificado 2026-09-18)

| Superficie | Mecanismo | ¿Auto al push `main`? |
| --- | --- | --- |
| Frontend Vercel proyecto `lavilet` | Git integration → build `next build` | **Sí** (histórico: commits “trigger vercel rebuild”) |
| Backend DigitalOcean | Dockerfile / App Platform o Droplet + Compose; guía `docs/DEPLOY_DIGITALOCEAN.md` dice **no despliega automáticamente** | **No** por defecto — hace falta deploy manual o auto-deploy DO ya vinculado al repo |

Variables WA nuevas en DO (cuando se publique Nest): `META_WA_CAPI_ACCESS_TOKEN`, `META_WA_LEAD_SUBMITTED_DELIVERY_ENABLED=false` (y no reutilizar token web).

## Orden de ejecución (cuando se autorice)

### Fase 0 — Preflight (sin activar)

1. Confirmar SHAs locales a publicar y que `origin` solo tiene `main` (+ ramas FE residuales ajenas a WA, si se dejan).
2. Confirmar flags OFF en FE y Nest (prod + staging).
3. Confirmar `META_WA_CAPI_ACCESS_TOKEN` distinto de `META_CAPI_ACCESS_TOKEN`.
4. Confirmar WABA ≠ messaging dataset ≠ pixel web.
5. **No** aplicar `supabase/local-only/*` ni `.env.local-admin.local` a prod.

### Fase 1 — Publicar código con flags OFF (migración WA **aún no** requerida)

Orden estricto:

1. **Nest primero** (manual DO o App Platform deploy del SHA Nest): imagen con lane WA; `META_WA_LEAD_SUBMITTED_DELIVERY_ENABLED=false`; health `/api/health` + `wa_messaging_token_configured`.
2. **FE después** (`git push origin main` → Vercel): flags `META_WA_*=false`. Con flags OFF, `maybeRegisterWaLeadSubmitted` hace short-circuit (`wa_lead_submitted_inactive`) **sin** tocar columnas `meta_wa_lead_submitted_*` ni RPC de conversión — seguro aunque la migración WA no exista aún.
3. Verificar Lead / ViewContent / Schedule web y bitácora outbox (tenant scope).
4. **No** encender evaluación ni delivery.

### Fase 2 — Migración FE controlada (solo cuando se vaya a evaluar/activar LS)

1. Aplicar **solo** `supabase/migrations/20260918120000_meta_wa_lead_submitted.sql` en Production (manual, un archivo).
2. Verificar columnas/RPC/stages de bitácora LS.
3. Rollback listo: usar script en `supabase/rollbacks/` si existe para ese timestamp; si no, revertir SQL documentado en el header de la migración.

### Fase 3 — Observabilidad CTWA real (antes de delivery)

1. Dejar captura CTWA activa (ya en código + tabla).
2. Esperar **primer** `message[add]` con referral real (ads CTWA).
3. Redactar webhook (`scripts/ctwa-webhook-capture-redact.mjs`) y comprobar fila en `lv_whatsapp_ctwa_attribution`.
4. **No** declarar que Kommo entrega `ctwa_clid` hasta ver evidencia.
5. Si Kommo no reenvía referral: falta cambio en integración Kommo / plantilla webhook (fuera de “encender flags”).

### Fase 4 — Activación gradual (conversiones)

Solo con CTWA real observado + consentimiento ads true + alcance tenant/proyecto:

1. Encender **solo** `META_WA_LEAD_SUBMITTED_ENABLED=true` (evaluación/bloqueo/pending en CRM). Delivery sigue OFF.
2. Verificar bitácora: `evaluated` / `blocked` / pending — **no** `meta_accepted`.
3. Encender `META_WA_LEAD_SUBMITTED_DELIVERY_ENABLED=true` en Nest **y** FE (mismo momento operativo).
4. Un caso controlado con CTWA real; exigir `meta_accepted` + `fbtrace_id` + `events_received`.
5. `backend_accepted` / `enqueued` ≠ aceptación Meta.

### Fase 5 — Reversión rápida

1. Poner ambos flags en `false` (FE + Nest).
2. Filas LS en outbox Nest quedan `pending` (no se pierden; no se claiman).
3. Lead / ViewContent / Schedule / Kommo / bot no dependen de estos flags.
4. No borrar outbox ni bitácora.

---

## Verificación post-paso (checklist)

- [ ] Login CRM → `/inmobiliaria/marketing/capi` con alcance tenant
- [ ] Stages visibles: evaluación, bloqueo, tránsito, rechazo Meta, aceptación Meta
- [ ] Badge **PRUEBA** solo en probes; `event_id` visible
- [ ] Sin POST Graph BM si delivery OFF
- [ ] Token WA en Authorization de LS; token web solo en eventos website
- [ ] Duplicado `wa_lead_submitted:{lead_id}` → `duplicate: true`
- [ ] Consent ≠ true → cancel/hold; no Graph
- [ ] Sin CTWA → bloqueo / no enqueue BM

---

## Qué no hacer

- Ampliar allowlist con `TestEvent` en producción
- Usar token web como fallback BM
- `supabase db push` masivo (arrastraría riesgos; local-only ya está fuera de `migrations/`)
- Activar delivery sin CTWA real verificado
- Tratar la sonda Graph independiente / preview HTML como validación Nest o Meta de producción
- Push/deploy desde esta preparación local sin autorización explícita
