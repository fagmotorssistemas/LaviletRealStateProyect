# Continuación revisión — WhatsApp → CAPI LeadSubmitted

**Sin push / deploy / migraciones remotas / eventos reales.** Conserva Pixel, CAPI web y Schedule.

## SHAs (tras este cierre)

| Repo | Tip anterior | Tip final (este cierre) |
| --- | --- | --- |
| Frontend `LaviletRealStateProyect` | `aac345f…` | ver commit local tras docs |
| Nest `backend-La-Vilet` | `94ab3ce…` | tip con `meta-acceptance` + consent pre-Graph |

## 1. Configuración Meta (solo lectura)

### Comprobado localmente
| Ítem | Valor |
| --- | --- |
| Pixel / dataset **web** | `923439043758658` (últimos 4: `8658`) — CAPI web activo |
| `META_WABA_ID` | **No configurado** en FE `.env.local` ni Nest `.env` |
| `META_MESSAGING_DATASET_ID` | **No configurado** |
| Permisos token (código/docs) | BM exige `whatsapp_business_management` + `whatsapp_business_manage_events` ([docs Meta BM](https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging/)) |

### Destino Graph correcto (Meta, no decisión de aislamiento)
1. WABA ID → `user_data.whatsapp_business_account_id` **y** endpoint Dataset API `GET/POST /{WABA_ID}/dataset`.
2. Dataset ID devuelto → único destino `POST /{DATASET_ID}/events`.
3. **Prohibido** usar el dataset/pixel web (`923439043758658`) como destino BM (rompe atribución CTWA). Nuestro rechazo de fallback web es alineado a Meta; el rechazo WABA≠dataset es defensa de misconfiguración del proyecto.

### “WhatsApp Marketing Message Event Sharing”
**No es el destino CAPI LeadSubmitted por su nombre.** En el ecosistema Meta, “message activity sharing” / Marketing Messages API es compartir actividad de mensajes de marketing (`message_activity_sharing`) para optimización de envíos — distinto del dataset de Conversions API for Business Messaging.  
**No elegir ese conjunto solo por el nombre.** Verificar el ID numérico con Graph (abajo).

### Pantallas / comandos de solo lectura (tú ejecutas; no pegues tokens aquí)

**A. Business Manager → WhatsApp accounts**  
Settings → Accounts → WhatsApp accounts → abrir la cuenta La Vilet → copiar **WhatsApp Business Account ID** (numérico). Ese es `META_WABA_ID`.

**B. Events Manager**  
Abrir cada dataset/conjunto. Anotar: nombre UI, **Dataset ID**, si está vinculado a Pixel web vs WhatsApp. El de LeadSubmitted BM debe ser el asociado al WABA, **no** el Pixel `…8658`.

**C. Graph (solo lectura; token en env local, no en chat)**
```bash
# Dataset ligado al WABA (respuesta = messaging dataset_id)
curl -s "https://graph.facebook.com/v21.0/${META_WABA_ID}/dataset?access_token=${TOKEN}"

# Comparar: NO debe ser igual al pixel web
# echo $MESSAGING_DATASET_ID  vs  923439043758658
```
Si el ID del conjunto “WhatsApp Marketing Message Event Sharing” **coincide** con el de `/{WABA_ID}/dataset`, entonces sí es el destino BM. Si no, no usarlo.

**D. Permisos del token (debug)**
```bash
curl -s "https://graph.facebook.com/debug_token?input_token=${TOKEN}&access_token=${APP_ID}|${APP_SECRET}"
```
Buscar `whatsapp_business_manage_events` y `whatsapp_business_management` sin pegar la respuesta completa con secretos.

### Pendiente externo (config)
- Identificar WABA La Vilet + dataset BM por Graph (no hecho aquí: IDs no están en env).
- Confirmar si el conjunto UI “WhatsApp Marketing Message Event Sharing” = ese dataset.

## 2. CTWA real (solo lectura)

| Fuente | Hallazgo |
| --- | --- |
| Tabla `lv_whatsapp_ctwa_attribution` (Production) | Existe; **0 filas** → **no observado** en prod |
| Código extractor `ctwa-from-kommo.ts` | Conserva first-touch **si** llega `ctwa_clid` |
| Docs Kommo `message[add]` | **No declara** `referral.ctwa_clid` |
| Meta Cloud API | Sí documenta `messages[].referral.ctwa_clid` en el **primer** mensaje |

**Diferencia:** “no observado” (0 filas) ≠ “Kommo no lo admite” (no probado; solo no documentado + nunca capturado). Desplegar código **no** crea el clid.

### Captura exacta necesaria (conversación genuina desde anuncio CTWA)
1. Webhook Kommo del **primer** mensaje (form/JSON aplanado), **anonimizado**:
   - Conservar claves que contengan `ctwa_clid` / `referral` / `source_type` / `source_id`.
   - Redactar teléfono, nombre, texto del mensaje, IDs internos de persona.
2. Confirmar si nuestra ruta persistió fila en `lv_whatsapp_ctwa_attribution` (`field_path` + `captured_at`) **sin** exponer el clid en el chat.
3. No crear campaña ni mensaje de prueba atribuido; usar un clic real de anuncio ya activo si existe.

## 3. Evidencia `meta_accepted` (corregido)

- Éxito API = HTTP 2xx + sin error Graph + `events_received` coherente (`meta-acceptance.ts`).
- `fbtrace_id` **opcional**; correlación primaria = `event_id`.
- Lotes N>1: no `meta_accepted` si `events_received !== N`.
- Capas: `backend_accepted` (drain→Nest) ≠ `meta_accepted` (Graph) ≠ Events Manager UI (`events_manager: not_verified_here`).

## 4. Consentimiento y apagado

- Nest outbox: revoke SQLite **y** relectura `leads.meta_ads_consent === false` en Supabase **antes** de Graph.
- `META_WA_LEAD_SUBMITTED_DELIVERY_ENABLED=false`: `claimPending` excluye `LeadSubmitted` (ya en SQLite); Lead/VC y Schedule (su propio flag) no se apagan por este control.

## 5. Activación / reversión (exacto)

1. Flags OFF en FE+Nest.  
2. Completar pendientes externos: WABA + dataset BM vía Graph; captura CTWA real.  
3. Migración `20260918120000_…` solo con autorización.  
4. Set `META_WABA_ID` + `META_MESSAGING_DATASET_ID` (distintos; ≠ pixel).  
5. Deploy Nest → FE. Verificar Pixel/Lead/Schedule.  
6. `META_WA_LEAD_SUBMITTED_ENABLED=true`.  
7. Delivery ON solo con CTWA verificado.  
8. Reversión: delivery OFF → feature OFF; no `_down` por defecto.

## Pruebas
Ver salida del cierre en el mensaje de entrega.
