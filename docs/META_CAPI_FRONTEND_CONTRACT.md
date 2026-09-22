# Contrato único — CAPI Meta bitácora + campañas/gasto (Cursor frontend)

**Repos:** `FrontLaVilet` + Nest `lavilet-meta-capi`.  
**No toca:** flags Meta, consentimiento, bot, Kommo, recepción WA, CTWA captura, showroom.  
**Pendientes separados:** Purchase CAPI (captura FE `review_hold`; Nest tipado pendiente — ver `META_NEST_BACKEND_CONTRACT.md`); LeadSubmitted Nest Droplet redeploy consent-absent.

---

## 1. Diagnóstico real (ViewContent)

Ejemplo `event_id=11bf7b00-a462-4e38-8b84-c94e7f63683f` (2026-09-22):

| Capa | Hallazgo |
|------|----------|
| FE `meta_capi_outbox` | `status=forwarded`, `delivery_lane=live`, sin `lead_id` (ViewContent anónimo OK) |
| Nest → CRM `meta_capi_conversion_log` | `stage=meta_accepted`, `events_received=1`, `fbtrace_id` presente |
| Panel antes | “Entregado al backend” + “Graph no verificada” porque **no leía** conversion_log |

**Conclusión:** el envío Graph **sí ocurrió y fue aceptado**. “No verificada” ≠ rechazado; faltaba sync de evidencia al panel.

### Bloque readonly Droplet (si hace falta SQLite)

```bash
cd /opt/lavilet-meta-capi
EVENT_ID=11bf7b00-a462-4e38-8b84-c94e7f63683f \
  bash scripts/diagnose-outbox-event-readonly.sh
# Compose: -p lavilet-capi · servicio lavilet-meta-capi
# Contenedor tipico: lavilet-capi-lavilet-meta-capi-1
# DB: /data/lavilet-meta-capi.db via better-sqlite3 readonly
```

No reenviar eventos solo para confirmar.

---

## 2. Contrato de estados del panel (outbox web)

Campo principal: `deliveryOutcome` (+ labels). Filtros/KPIs/paginación usan el mismo enum.

| `deliveryOutcome` | Significado | Evidencia mínima |
|-------------------|------------|------------------|
| `pending` | Aún en cola CRM | outbox `pending` |
| `nest_received` | Recibido por Nest | outbox `forwarded` (flush/drain OK). **No** implica Graph |
| `meta_accepted` | Aceptado por Meta | `conversion_log.meta_accepted` con `events_received≥1` o `fbtrace_id`, **o** Nest GET `api_accepted=true` |
| `blocked` | Bloqueado | `not_configured`, `cancelled`, `needs_review`/`review_hold` + motivo |
| `failed_retrying` | Fallido / reintentando | outbox `dead` / Nest `failed\|dead` / `meta_rejected` |
| `unknown` | Resultado desconocido | Nest `sent` sin evidencia Graph suficiente |

Campos conservados por fila: `eventId`, `deliveryLane` (test|live), `channel`, `datasetHint`, `forwardedAt`, `registeredAt`, `graphFbtraceId`, `graphEventsReceived`, `connectedLead` (solo si hay lead comprobado). ViewContent sin teléfono **no es fallo**.

**Nest GET** (nuevo): `GET /api/v1/events/:eventId` + `X-Internal-Secret` →

```json
{
  "ok": true,
  "found": true,
  "event_id": "…",
  "status": "sent|pending|failed|dead|…",
  "api_accepted": true,
  "acceptance_tier": "api_accepted|api_rejected|insufficient_evidence|unknown",
  "meta_response": {
    "http_status": 200,
    "events_received": 1,
    "fbtrace_id": "…",
    "error_code": null,
    "error_type": null
  },
  "attempt_count": 1,
  "delivery_lane": "live",
  "dataset_id": "…",
  "sent_at": "…",
  "last_error": null
}
```

---

## 3. Campañas / gasto / CPL

| Concepto | Fuente | Nota |
|----------|--------|------|
| Anuncio → conjunto → campaña | Graph `GET /{ad_id}?fields=…` con **META_ADS_ACCESS_TOKEN** + **META_AD_ACCOUNT_ID** | No usar tokens CAPI/WA |
| Gasto | Insights `/{act_…}/insights` level=ad, mismo `from`/`to` del embudo | `spendFetchedAt` en fila |
| Leads CRM | `leadsUnique` CTWA `source_id` cohorte | Distinto de Meta `actions` |
| Temperatura | buckets F/T/C/SC de esos leads | |
| Resultados Meta | `metaReportedResults` (suma `actions`) | No es denominador CPL |
| CAPI aceptadas | `capiMetaAccepted` (reservado; capa distinta) | ≠ atribución campaña |
| **CPL** | `adSpend / leadsUnique` | Sin `leadsUnique>0` → UI **“No disponible”** |

Env (Nest **no**):

```
META_AD_ACCOUNT_ID=act_…
META_ADS_ACCESS_TOKEN=…   # System User ads_read
# opcionales: META_MARKETING_ACCESS_TOKEN, META_SYSTEM_USER_TOKEN
# NUNCA: META_CAPI_ACCESS_TOKEN / META_WA_CAPI_ACCESS_TOKEN
```

Si faltan: `resolutionStatus=missing_ads_token` / UI **“Datos publicitarios no disponibles”**.

**Cómo obtener el token (ops, sin pegarlo en chats):**

1. Meta Business Suite → **Configuración del negocio** → **Usuarios** → **Usuarios del sistema**.
2. Crear o elegir un System User; asignar la **cuenta publicitaria** correcta (`act_…`) con permiso **`ads_read`** (Insights / lectura de anuncios).
3. Generar un token de ese System User (Marketing API).
4. En **Vercel → Project → Settings → Environment Variables → Production** (server-only):  
   `META_AD_ACCOUNT_ID=act_…` y `META_ADS_ACCESS_TOKEN=…`  
   **No** reutilizar `META_CAPI_*` ni `META_WA_CAPI_*`.
5. Redeploy Production. Verificar en `/inmobiliaria/marketing/metricas` nombres/gasto o el mensaje de no disponibles.

**Aceptación Graph CAPI ≠ atribución a campaña.** Una fila `meta_accepted` no prueba “esta campaña”; el embudo usa CTWA `source_id` + Insights.

---

## 4. UI a terminar (este contrato)

### Bitácora CAPI (`MetaCapiBitacoraView`)
- KPIs: Pendiente / Recibido Nest / Aceptado Meta / Bloqueado / Fallido / Desconocido
- Filtro `statusBucket` = mismos outcomes
- Columna recepción + hint Graph (`fbtrace` / `events_received`) cuando exista
- Distinguir lane test vs live (ya en fila)

### Métricas embudo (`MarketingFunnelMetricsView`)
- Columnas: Anuncio/campaña (nombres+IDs), Leads CRM, F/T/C/SC, Gasto, CPL, Meta results, citas, reservas, ventas
- CPL “No disponible” si null
- No repartir gasto a unidades

---

## 5. Despliegue

### Nest (`D:\La Vilet\lavilet-meta-capi`)
1. Commit con GET lookup + script diagnose readonly.
2. En Droplet: `cd /opt/lavilet-meta-capi && git pull && docker compose -p lavilet-capi up -d --build`
3. Verificar: `curl -sS -H "X-Internal-Secret: $SECRET" http://127.0.0.1:3010/api/v1/events/<event_id>`
4. No cambiar tokens CAPI/WA ni flags.

### Front (`FrontLaVilet`)
1. Commit bitácora + embudo Ads + tests.
2. Deploy Vercel Production (main).
3. Opcional: set `META_AD_ACCOUNT_ID` + `META_ADS_ACCESS_TOKEN` en Vercel (server-only). Sin ellas el embudo sigue; muestra `missing_ads_token`.

### Verificación
- Abrir `/inmobiliaria/marketing/capi`: ViewContent recientes deben pasar a **Aceptado por Meta** si hay fila `meta_accepted` (sin reenviar).
- Abrir `/inmobiliaria/marketing/metricas`: columnas gasto/CPL; sin token Ads → “No disponible” / missing token en resolución.

---

## 6. Qué no hacer
- No marcar históricos `meta_accepted` sin evidencia.
- No reenviar para “confirmar”.
- No mezclar leads CRM, Meta results y CAPI accepted en un solo KPI.
- No distribuir gasto por unidad sin evidencia.
