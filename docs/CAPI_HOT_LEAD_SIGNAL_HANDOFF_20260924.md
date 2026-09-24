# Matriz CRM → CAPI para calificación y acciones comerciales

## Fuente y alcance

El CRM sigue siendo la única fuente de temperatura. La preparación no calcula
puntos ni modifica reglas. La calificación común nace de
`lead_interest_evaluations` y requiere un cambio correspondiente en
`lead_temperature_history`; acepta `tibio` y `caliente` evaluados.

`recognized_events` se conserva completo. Las etiquetas internas se derivan solo
de esos valores persistidos:

- `asked_financing` → `financiamiento`.
- `declared_unit_type` → `interes_en_tipo_de_unidad`.
- `requested_visit` → `cita_solicitada`.
- `confirmed_visit` → `cita_confirmada`.
- Cualquier otro valor registrado → `otro_motivo_registrado:<evento>`.

Estas etiquetas explican la calificación. No crean por sí mismas Schedule,
Purchase ni un evento CAPI adicional.

## Matriz que debe aceptar backend

| Hecho persistido                          | Evento Meta                                   | Canal / dataset                                                                   | Identidad                     | Repetición                                                                   |
| ----------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------- |
| Primer interés CTWA elegible              | `LeadSubmitted`                               | `business_messaging` / mensajería                                                 | `wa_lead_submitted:{lead_id}` | Una vez por adquisición; los existentes no se reenvían                       |
| Primera calificación CRM tibia o caliente | `QualifiedLead`                               | `business_messaging` / mensajería                                                 | `wa_crm_qualified:{lead_id}`  | Una calificación común por lead; cambiar etiqueta o temperatura no crea otra |
| Cita confirmada por el cliente            | `Schedule` solo donde el canal esté soportado | Web: `website` / web. WhatsApp: pendiente porque `Schedule` BM no está verificado | `schedule:{appointment_id}`   | Una vez por cita confirmada; una solicitud o financiamiento no cuentan       |
| Cierre de venta real                      | `Purchase`                                    | `system_generated` / dataset web acordado                                         | `purchase:{sale_id}`          | Una vez por cierre; nunca representa temperatura                             |

Una persona puede conservar todos estos hechos porque sus claves proceden de
entidades distintas. Un reintento conserva `event_id`, fecha y clave del hecho.

## Preparación local desactivada

La migración `20260924213000_hot_lead_capi_signal_staging.sql` guarda la
primera calificación tibia/caliente en `meta_crm_qualification_intents`, junto con
contacto, proyecto, evaluación, fecha real, mensaje fuente, motivos y primera
atribución CTWA. No inserta en `meta_capi_outbox`.

La migración posterior `20260924214000_enable_crm_qualified_lead_outbox.sql`
confirma `proposed_event_name=QualifiedLead` y añade el enlace atómico al outbox.
La configuración `meta_capi_signal_activation` nace con `enabled=false`; por ello
las filas permanecen retenidas y no se envían.

1. El evento confirmado para la señal es `QualifiedLead`; no reutiliza
   `LeadSubmitted`.
2. DTO y allowlist para `qualification_source`, temperatura y etiquetas de
   evidencia, sin convertirlas en reglas de puntuación.
3. El flag independiente es
   `META_WA_CRM_QUALIFICATION_DELIVERY_ENABLED=false`.
4. Un consumidor exclusivo que conserve `wa_crm_qualified:{lead_id}`, `event_id`,
   `event_time` y atribución en todos los reintentos.

Sobre propuesto después de acordar el nombre:

```json
{
  "event_name": "QualifiedLead",
  "event_id": "<UUID_PERSISTIDO>",
  "event_time": "<EPOCH_DE_QUALIFIED_AT>",
  "idempotency_key": "wa_crm_qualified:<lead_id>",
  "action_source": "business_messaging",
  "messaging_channel": "whatsapp",
  "lead_id": "<lead_id>",
  "tenant_id": "<tenant_id>",
  "project_id": "<project_id>",
  "contact_id": "<contact_id_original>",
  "ctwa_clid": "<atribucion_original>",
  "whatsapp_business_account_id": "<META_WABA_ID>",
  "messaging_dataset_id": "<META_MESSAGING_DATASET_ID>",
  "qualification_source": "crm_persisted_evaluation",
  "temperature": "tibio|caliente",
  "evidence_labels": ["<motivos_persistidos>"]
}
```

## Exclusiones, consentimiento e históricos

- La clasificación persistente más reciente `internal` y
  `lv_auto_config.test_lead_id` quedan `excluded`.
- Una revocación explícita queda retenida. No se cambia el tratamiento vigente del
  consentimiento ausente.
- Sin contacto o atribución CTWA se conserva un motivo; no se inventan datos.
- No hay backfill. Los `LeadSubmitted` históricos permanecen intactos.
- Las acciones concretas siguen en sus productores actuales: confirmación de cita
  para Schedule y `unit_sales_closings` para Purchase.

## Objetivo de volumen de siete días

`optimizationVolume.ts` calcula por separado, para cada tipo de evento:

- capturados localmente;
- aceptados por Meta con evidencia;
- resultados atribuidos por Meta;
- brecha individual frente a 50 para cada una de esas etapas;
- cobertura incompleta de entrega y atribución;
- desglose por conjunto de anuncios únicamente cuando `adSetId` está verificado.

No suma calificaciones, citas y ventas en un único resultado de optimización. Un
evento sin atribución verificada permanece en cobertura incompleta.

Para completar ese nivel, el resultado durable del backend debe exponer en
`details` exclusivamente cuando proceda de Meta:
`attribution_verified=true`, `meta_attributed=true|false` y
`attributed_adset_id`. Si esos campos faltan, el frontend conserva el evento como
capturado/aceptado según corresponda y marca atribución incompleta.

## Activación futura

### Evidencia local previa a la activación

- `qualifiedLeadRetry.test.ts` captura un `QualifiedLead` tibio con motivo
  `financiamiento`, simula un fallo de transporte, cambia la ficha corriente a
  caliente y vuelve a vaciar la outbox. Las dos llamadas tienen exactamente el
  mismo snapshot: `event_id`, `event_time`, `idempotency_key`, temperatura y
  motivos. El retry no reconstruye evidencia desde la ficha mutable.
- `commercialEventOverlap.test.ts` usa los productores ejecutables de solicitud
  de información y cita confirmada. Un mismo lead con evidencia interna de
  financiamiento produce `Lead` (`lead:{lead_id}`) y después `Schedule`
  (`schedule:{appointment_id}`); la calificación conserva su identidad
  `wa_crm_qualified:{lead_id}`. Repetir el mismo hecho de cita se deduplica, sin
  convertir la etiqueta en solicitud, cita o venta.

1. Instalar el backend y la matriz que admiten `QualifiedLead`, con el flag apagado.
2. Aplicar staging sin consumidor y ejecutar
   `operations/verify_hot_lead_signal_staging_readonly.sql`.
3. Probar fixtures aislados de internos, consentimiento e identidad.
4. Instalar `20260924214000_enable_crm_qualified_lead_outbox.sql`; su configuración nace apagada.
5. Probar eventos nuevos en carril test y comprobar deduplicación por familia.
6. Activar desde una fecha de corte nueva; nunca liberar históricos en masa.

Orden operativo sin `db push` general:

1. Aplicar explícitamente `20260923205830_disable_destructive_contact_resets.sql` y verificar las protecciones de contacto, outbox, RLS, consentimiento e idempotencia.
2. Aplicar explícitamente `20260923211512_interest_evaluation_evidence.sql`; verificar `lead_interest_evaluations` y `lv_evaluate_message_interest`.
3. Aplicar explícitamente `20260923174920_kommo_message_evidence.sql`; verificar la recepción durable, `lv_record_message_evidence` y `lv_receive_kommo_observation`, sin ejecutar funciones comerciales durante esta comprobación. El orden es operativo por dependencia y no por el timestamp del nombre.
4. Aplicar explícitamente `20260924213000_hot_lead_capi_signal_staging.sql` y verificar los intents retenidos.
5. Aplicar explícitamente `20260924214000_enable_crm_qualified_lead_outbox.sql`; tanto la captura como la entrega continúan apagadas.
6. Desplegar frontend y backend con `META_WA_CRM_QUALIFICATION_DELIVERY_ENABLED=false` y `meta_capi_signal_activation.enabled=false`.
7. Para una prueba nueva, fijar primero WABA, dataset, carril y `cutover_at`; activar la captura DB solo después de comprobar el contrato. Activar el consumidor backend al final.

Detención: poner en `false` el flag del backend y después `meta_capi_signal_activation.enabled`. Esto conserva intents, outbox, SQLite y resultados; no borra ni cambia identidades. Registrar la hora del corte, conteos por estado y último `event_id` antes y después.
