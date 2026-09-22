# Consentimiento y finalidades — La Vilet WhatsApp / Meta

Documento de auditoría (2026-09-22). **No cambia flags ni envíos** por sí solo.

## 1. Finalidades (separar siempre)

| Finalidad | Qué es | ¿Requiere frase Meta? | Gate actual en código |
| --- | --- | --- | --- |
| **A. Atención solicitada** | Responder al inbound del cliente (ventana 24h / bot / asesor) | No | `bot_enabled`, reglas conversación — **independiente** de `meta_ads_consent` |
| **B. Analítica interna** | Contar leads, temperatura, citas, ventas, embudo | No | Informe CRM / `fetchMarketingFunnelMetrics` — **sin** consentimiento ads |
| **C. Medición publicitaria (CAPI)** | Enviar `LeadSubmitted` / `Lead` / `ViewContent` / `Schedule` a Meta | Política Meta + LOPDP Ecuador | `meta_ads_consent === true` (+ CTWA/IDs BM donde aplique) |
| **D. Mensajes promocionales proactivos** | Templates marketing fuera de ventana de servicio | Opt-in WhatsApp business messaging | Distinto de CAPI; no confundir con (C) |

Iniciar el chat **no** concede (C) ni (D). Eso es correcto.

## 2. Requisitos externos vs código propio

### Meta (CAPI Business Messaging)
Fuente: [Conversions API for Business Messaging](https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging/).

- Eventos BM admitidos incluyen `LeadSubmitted`, `Purchase`, etc. **No** lista `Schedule` para BM (Nest rechaza Schedule+BM).
- Exige `ctwa_clid`, WABA, dataset de mensajería, `action_source=business_messaging`.
- La guía CAPI BM **no** exige una frase literal del tipo «acepto publicidad Meta» como campo Graph. La medición se basa en el evento + atribución CTWA.
- Opt-in de **mensajería proactiva** (plantillas) es política WhatsApp distinta a reportar una conversión CAPI dentro de un hilo ya iniciado por el usuario.

### Ecuador (tratamiento de datos)
- LOPDP / consentimiento para tratamientos no necesarios para la ejecución del servicio solicitado.
- Atender una consulta iniciada por el cliente (A) y métricas internas agregadas (B) no deben condicionarse a una autorización publicitaria.
- Compartir identificadores/comportamiento con Meta para optimizar anuncios (C) es un tratamiento de **medición/publicidad** que conviene basar en aviso claro + aceptación o en otra base legítima documentada por asesoría legal (no inventada aquí).

### Restricciones **añadidas por nuestro código** (no dictadas literalmente por CAPI BM)
- NLP estricto: solo concede si el cliente escribe formulaciones tipo «acepto publicidad / autorizo anuncios» (`waLeadSubmittedConsent.ts`).
- Nest/FE: envío `LeadSubmitted` solo si `meta_ads_consent === true` + scope.
- Interés comercial gate aparte (`explicitPropertyInterest`) — calidad de conversión, no consentimiento.

## 3. Flujo menos intrusivo propuesto (sin auto-consent)

1. **Atención + métricas internas (A+B):** sin fricción de frase Meta. Ya posible; el embudo CRM no depende de elegibilidad CAPI.
2. **Aviso en el primer turno del bot** (una línea, no bloqueante): informar que usamos la conversación y datos de contacto para atender la consulta y, si aplica, medir el rendimiento del anuncio que lo trajo (link a política).
3. **Aceptación adicional solo para (C)** cuando se vaya a enviar CAPI: pregunta clara de una línea, p.ej. «¿Autorizas que registremos esta consulta para medir nuestros anuncios? Responde *Sí* o *No*».
   - `Sí` / `si autorizo` / `ok` **solo** si es respuesta directa a esa pregunta (evidencia = mensaje + timestamp + scope `whatsapp_ads`).
   - No inferir grant desde inbound CTWA, “más info”, ni silencio.
4. **Revocación:** conservar NLP de rechazo; cancelar outbox pendiente.
5. **No** poner `meta_ads_consent=true` automáticamente al abrir el chat.
6. **No** quitar el bloqueo de envío CAPI hasta desplegar (3) + tests + registro de evidencia.

## 4. Estado operativo flags (verificado lectura)

- Vercel Production: `META_WA_LEAD_SUBMITTED_ENABLED=true`, `DELIVERY=true`, Pixel ID configurado, simulate=false.
- Nest: recepción WA ON, drain ON, linked CTWA > 0.
- **No desactivar** durante el análisis.

## 5. Implementación relacionada

- Embudo interno: `src/services/marketingFunnel.service.ts` + `marketing/metricas/actions.ts`.
- Interés comercial ampliado (disponibilidad / bien identificado): `commercial-engagement.ts` — afecta elegibilidad LS, **no** fabrica consent.
