# Contrato CAPI — content_type home_listing (match rate catálogo)

Fecha: 2026-09-25. Dataset web `923439043758658`. Core Setup conservador **sigue ON** (`NEXT_PUBLIC_META_CORE_SETUP_CONSERVATIVE=true`): el frontend **no** envía `content_*` en Pixel ni en outbox mientras esté activo.

## Evidencia FE (no declarar match rate)

- Feed: `https://www.lavilett.com/api/meta/home-listings/catalog.csv` — 65 filas; `home_listing_id` = `units.id`.
- Outbox ViewContent live: tiene `unit_id` UUID; **no** tiene `content_ids` ni `content_type` (conservador).
- Todos los `unit_id` recientes de ViewContent/AddToWishlist están en el feed.
- Pixel Event Manager sin parámetros de contenido: esperado bajo Core Setup.

## Qué debe hacer Nest al armar Graph `custom_data`

Si Meta Events Manager ya muestra `content_ids` en eventos CAPI, Nest está derivando IDs (p. ej. desde `unit_id`). Para Advantage+ catalog ads de real estate:

| Campo Graph `custom_data` | Valor obligatorio |
| --- | --- |
| `content_ids` | Array con exactamente `unit_id` del POST/outbox (= `home_listing_id` del feed). No usar `unit_number`, tipología ni otro identificador. |
| `content_type` | Exactamente `home_listing` (Marketing API Real Estate Ads / audience). |

Eventos web con unidad: `ViewContent` (`lv_internal_subtype=detalle_unidad`), `AddToWishlist`, `Lead` con `unit_id`.

**No** inventar `content_ids` en `ViewContent` `showroom_general` (sin unidad).

Cuando el frontend envíe `content_type` / `content_ids` en el POST plano `/api/v1/events` (fuera de Core Setup), **conservarlos** en Graph; no descartarlos. Hoy el contrato documentaba que `content_type` se perdía en el adaptador.

## Campo POST plano FE → Nest (cuando Core Setup = false)

```json
{
  "event_name": "ViewContent",
  "unit_id": "<uuid units.id>",
  "content_ids": ["<mismo uuid>"],
  "content_type": "home_listing",
  "content_name": "Unidad 001"
}
```

`content_category` tipología/`unit` **no** sustituye a `content_type`.

## Fuera de alcance

No desactivar Core Setup desde este cambio. No tocar WhatsApp BM, scoring ni QualifiedLead.
