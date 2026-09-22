# Matriz eventos Meta — La Vilet (auditoría operativa)

| Hecho | Evento | Canal | Nest envío | Disparador FE | Dedup |
| --- | --- | --- | --- | --- | --- |
| Visita página pública | `PageView` | Pixel browser | No (solo Pixel) | `MetaPixel` layout | Pixel |
| Showroom 360 listo | `ViewContent` + subtipo `showroom_general` | website | Sí | `MetaViewContentShowroom` | `view:showroom:{visitor}` |
| Abre ficha unidad | `ViewContent` + subtipo `detalle_unidad` | website | Sí | `MetaViewContentUnit` | `view:{visitor}:{unit}` |
| Guarda favorito | `AddToWishlist` + `favorito` | website | **No** (captura `review_hold`) | post-`saveTourUnit` | `wishlist:{lead}:{unit}` |
| Solicita info web | `Lead` + `solicitud` | website | Sí | `info_request` only | `lead:{lead_id}` |
| Interés WA CTWA | `LeadSubmitted` | BM | Sí* | `maybeRegisterWaLeadSubmitted` | `wa_lead_submitted:{lead}` |
| Cita confirmada web | `Schedule` + `cita` | website | Flags Schedule | post-confirm | `schedule:{appointment}` |
| Cita WA BM | Schedule BM | — | Rechazado Nest | — | — |
| Venta confirmada CRM | `Purchase` + `compra` | website | **No** (preparado) | post-`unit_sales_closings` | `purchase:{sale_id}` |
| Búsqueda web | `Search` | — | — | **Sin disparador** | — |
| Reserva | — | — | — | **Fuera de matriz** | — |

\*LeadSubmitted: FE consent-absent OK; **Nest Droplet debe redeploy** gate alineado (ver `META_NEST_BACKEND_CONTRACT.md`).

### Categorías (no mezclar)
1. Temperatura lead CRM  
2. `units.category`  
3. Categoría Ads Insights  

### Purchase (preparado)
- `value` = `sale_price_final`; currency omitida si no hay columna.
- Sin cuotas/anticipos; anulación `contracts.anulado` antes de activar CAPI.

### “sent” ≠ aceptación Meta
Bitácora: `meta_accepted` solo con evidencia Graph. `pending_backend_support` = captura sin Nest tipado.
