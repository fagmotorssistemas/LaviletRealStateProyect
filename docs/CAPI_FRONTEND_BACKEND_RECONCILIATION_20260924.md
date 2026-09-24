# Conciliación frontend con contrato final CAPI

Fuente normativa leída: `D:\La Vilet\lavilet-meta-capi\docs\CAPI_CONTRACT_FINAL.md`.
Cambios solo locales en FrontLaVilet; no se enviaron eventos.

## Contrato aplicado

- Los seis eventos usan UUID, fecha original, clave estable y `resolveDeliveryLane`.
- ViewContent, Lead, AddToWishlist y Schedule usan `website`; LeadSubmitted usa
  `business_messaging`; Purchase usa `system_generated`.
- Lead usa `lead:{lead_id}`. Favorito, cita, LeadSubmitted y Purchase conservan las
  claves del contrato final.
- Schedule, LeadSubmitted y Purchase mantienen flags independientes. El flush común
  vuelve a comprobarlos; `review_hold` y `needs_review` nunca se liberan por barrido.

## Diferencias resueltas

1. Purchase relee `unit_sales_closings` por venta, contacto y unidad. `sale_at`,
   `registered_at`, valor, moneda y tenant salen de esa fila. Sin fecha se conserva
   `review_hold` con `purchase_sale_at_required` o
   `purchase_registered_at_required`; `event_time=0` es un sentinel local retenido,
   nunca un timestamp enviado. Se eliminaron todos los fallback a la hora actual.
2. LeadSubmitted transporta simultáneamente WhatsApp, CTWA, WABA y dataset de
   mensajería. Rechaza WABA=dataset y dataset mensajería=dataset/píxel web. Fuera de
   website se omiten URL, fbp/fbc/fbclid, IP y UA. Su fecha procede del mensaje o del
   sello comercial persistido y su carril usa el resolver común.
3. Un 409 `idempotency_key_conflict` queda en la misma fila como conflicto visible.
   La persistencia local también compara evento, ID explícito, fecha explícita,
   carril y dataset. No genera otra identidad.
4. La lectura reconoce literalmente `backend_accepted`, `transport_failed`,
   `meta_rejected`, `meta_unverified`, `meta_accepted` y `cancelled`. Solo
   `meta_accepted` con evidencia Graph se muestra como aceptado por Meta.

## Validación pendiente

- Los payloads de [CAPI_LOCAL_TEST_PAYLOADS.json](CAPI_LOCAL_TEST_PAYLOADS.json) son
  fixtures; usan IDs y host no reales y no deben enviarse a producción.
- Falta ejecutar la integración contra el backend local en modo disabled/test,
  comprobar el 409 incompatible, cada estado GET y la cola durable de resultados.
- Falta validar entrega/deduplicación en Meta Test Events. Compilar o simular no lo
  acredita.
- RLS de cierres sigue pendiente con JWT reales. No se tocó puntuación, temperatura,
  consentimiento ni bots.
