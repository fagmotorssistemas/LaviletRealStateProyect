# Señal CAPI al quedar caliente — contrato pendiente

## Decisión local

La fuente autoritativa es `lead_interest_evaluations`, escrita por
`lv_evaluate_message_interest`. Esa fila conserva el mensaje entrante, su fecha,
los eventos reconocidos, las reglas usadas y la temperatura final. La preparación
no calcula puntos ni cambia las reglas del CRM.

La migración local `20260924213000_hot_lead_capi_signal_staging.sql` captura solo
la primera evaluación cuyo resultado persistido sea `caliente` y tenga un cambio
correspondiente en `lead_temperature_history` desde un valor distinto. Guarda una
intención durable con contacto, tenant, proyecto, fecha de evaluación, mensaje
fuente y la primera atribución CTWA del mismo contacto/proyecto. Frío, tibio y
ausencia de evaluación no generan intención.

## Separación de LeadSubmitted

El `LeadSubmitted` existente describe el primer interés comercial CTWA y usa
`wa_lead_submitted:{lead_id}`. No se modifica, reetiqueta ni vuelve a enviar.

La calificación posterior reserva `wa_hot_qualified:{lead_id}`, otro `event_id` y
la fecha real `evaluated_at`. También guarda el `event_id` de LeadSubmitted inicial
si existe. No inserta en `meta_capi_outbox`: queda en
`meta_hot_lead_signal_intents` con `proposed_event_name = NULL`, estado `held` y
los motivos `backend_event_contract_pending` y `feature_disabled`.

Esto evita convertir silenciosamente dos hechos distintos en el mismo evento. El
contrato final actual del backend declara que temperatura está fuera de su matriz;
por tanto backend debe confirmar antes de activar:

1. El nombre de evento Business Messaging aceptado por Meta para una calificación
   posterior con el objetivo «Maximizar clientes potenciales a través de mensajes».
2. El DTO, destino de dataset y campos permitidos para distinguir calificación de
   adquisición sin cambiar el significado de `LeadSubmitted`.
3. Un flag independiente, por ejemplo `META_WA_HOT_LEAD_DELIVERY_ENABLED=false`,
   y un consumidor que reclame exclusivamente estas intenciones.
4. La respuesta idempotente para `wa_hot_qualified:{lead_id}` y la conservación de
   `event_id`, `event_time` y atribución en reintentos.

Sobre propuesto una vez acordado el nombre del evento:

```json
{
  "event_name": "<BACKEND_CONFIRMED_MESSAGING_EVENT>",
  "event_id": "<UUID_PERSISTIDO_EN_LA_INTENCION>",
  "event_time": "<EPOCH_DE_QUALIFIED_AT>",
  "idempotency_key": "wa_hot_qualified:<lead_id>",
  "action_source": "business_messaging",
  "messaging_channel": "whatsapp",
  "lead_id": "<lead_id>",
  "tenant_id": "<tenant_id>",
  "project_id": "<project_id>",
  "contact_id": "<contact_id_original>",
  "ctwa_clid": "<atribucion_original>",
  "whatsapp_business_account_id": "<META_WABA_ID>",
  "messaging_dataset_id": "<META_MESSAGING_DATASET_ID>",
  "qualification_source": "crm_persisted_hot_evaluation"
}
```

`event_name` y `qualification_source` requieren aceptación expresa del DTO del
backend. No se reutiliza `wa_lead_submitted:{lead_id}` ni su `event_id`.

## Exclusiones y bloqueos

- La clasificación persistente más reciente `internal` y el contacto configurado
  como `lv_auto_config.test_lead_id` quedan `excluded`.
- Consentimiento explícitamente revocado queda retenido. No se cambia la política
  vigente para consentimiento ausente.
- Sin `contact_id` o sin atribución CTWA original se registra el motivo; no se
  fabrica identidad, anuncio ni fecha.
- Cada lead produce como máximo una intención caliente. Otra evaluación o un
  reintento conserva la primera identidad.
- La migración no hace backfill. Los `LeadSubmitted` existentes siguen intactos y
  no se promueven ni reenvían.

## Orden futuro de activación

1. Acordar y versionar el contrato backend/Meta del evento.
2. Aplicar la migración de staging, aún sin consumidor.
3. Verificar exclusiones, atribución y consentimiento con fixtures aislados.
   `operations/verify_hot_lead_signal_staging_readonly.sql` comprueba que no haya
   filas listas/enviadas, duplicados ni colisiones con el outbox histórico.
4. Desplegar backend y frontend con el flag nuevo apagado.
5. Probar una transición nueva en carril test y comprobar deduplicación.
6. Activar el flag independiente solo desde una fecha de corte nueva. Nunca barrer
   automáticamente intenciones o `LeadSubmitted` históricos.
