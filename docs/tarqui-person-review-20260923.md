# Casa De Tarqui: comprobación real por persona

Consulta de solo lectura vía MCP Supabase xhjnyntywqhczdtecgim. Negocio a1b2c3d4-0001-4000-8000-000000000001. Anuncio guardado para todas las personas: 52625518901665. Fechas siguientes en Ecuador (UTC−5).

| Nombre guardado | Ficha Kommo | Primer entrante disponible en CRM | Primera respuesta enviada |
| --- | --- | --- | --- |
| Olga Minchalo | 4616560 | 21/09/2026 16:18:28 | No verificable |
| Veronica Arpi | 4616928 | 21/09/2026 16:24:57 | No verificable |
| Tefita | 4618720 | 21/09/2026 17:03:03 | No verificable |
| . | 4623850 | 21/09/2026 19:24:11 | No verificable |
| Juan Carlos Siguenza Cres | 4625786 | 21/09/2026 20:25:38 | No verificable |
| Fernando | 4626684 | 21/09/2026 20:58:11 | No verificable |
| Alvaro | 4627288 | 21/09/2026 21:17:17 | No verificable |
| Mocho Izquierdo | 4631664 | 21/09/2026 23:05:16 | No verificable |

Fuente por persona: messages.sent_at, role=cliente, relacionado mediante conversations.lead_id con la ficha; corroborado por lv_integration_events.payload.externalId y sentAt. La atribución está en lv_whatsapp_ctwa_attribution.source_id. Las ocho fichas tienen una sola conversación CRM almacenada; sus 18 mensajes son entrantes. No se tomó una respuesta de otra ficha ni de una conversación anterior.

## Trazabilidad del primer entrante

| Ficha Kommo | Conversación CRM | Chat guardado en evento Kommo | ID externo del primer entrante |
| --- | --- | --- | --- |
| 4616560 | 59097964-9680-4977-82fb-76988db26f1c | 79d9cccf-ddba-4e73-8652-7a99af42f03d | de8c70f7-3e7b-4978-88d7-8aa41feb9e21 |
| 4616928 | 78028469-ca76-4568-8b56-c01aef2278b2 | 92f2d72f-3b5b-4edc-9f13-e01296dd8d3e | d335ff00-d5ee-4a0c-a8d1-62ea61c738ac |
| 4618720 | b100fc9d-7064-402c-bb0c-85c334c73d38 | 88a1f173-be51-4305-a1fe-596c0c67945e | 6318ff14-cec1-4cea-b71f-35cb735624e1 |
| 4623850 | 750a2816-2d37-4d82-aa7c-7f18624c6ba3 | fe8d252a-7691-4ab7-b275-6b566912f462 | 5e858377-6c18-4d95-b9e0-ad2b5d260c2b |
| 4625786 | e7f4c8eb-3706-4747-99e3-9d3a0a21b272 | cbaa3212-a97d-4570-9cdd-5eac73ddf2b9 | 5745c988-0fd7-4ba9-9748-b023937d784a |
| 4626684 | e45aa98f-6e60-4b81-b03b-d48a17710f9a | c9d85a53-39ce-4b1d-9fdf-324f93c5c48b | cc951a65-5884-4eda-8753-46c3d72a9894 |
| 4627288 | f2c1b202-0bc9-4c4f-b54a-354e752ba554 | b627ce45-ddc3-4f34-a567-a33921f44771 | d424ece5-df59-466e-b9d8-83bf8b79f4c0 |
| 4631664 | 54052e9c-7631-4759-95b2-c35ee6541128 | f1addbde-0151-4167-b217-6dee313e955d | 83c5739f-6b25-4dcf-bd8c-274784958c78 |

Límite: la atribución conserva identificadores wamid de WhatsApp distintos de los IDs Kommo de messages. El vínculo por ficha/contacto no demuestra por sí solo que el primer mensaje guardado sea el inicio de la conversación publicitaria. No se equipararon IDs ni se infirió esa relación por proximidad temporal. Es necesario consultar el historial original y su referencia publicitaria para certificarla. Sin salientes originales tampoco puede probarse el par entrante/respuesta del anuncio.

## Contador y detalle

Ejecutada la lógica actual evaluateAttention y buildAdvertisingPanel con una copia local de las filas reales consultadas, filtrando anuncio 52625518901665: ocho contactos, responded=[], unanswered=[], verify=los ocho IDs anteriores. El componente usa estos mismos conjuntos para el número y para displayedIds del panel. Resultado sustentable: cero respondidos comprobados, cero sin responder comprobados y ocho por verificar. No equivale a afirmar que nadie respondió.

Este contraste es ejecución local del cálculo con datos reales almacenados, no una prueba con personas inventadas. No se abrió una sesión autenticada de la pantalla desplegada ni se certificó el historial de Kommo. No se ha demostrado visualmente el estado remoto actual.

Hallazgo adicional: loadMarketingAttention aún carga todas las conversaciones de una ficha, y evaluateAttention busca el primer entrante y una respuesta posterior en ese conjunto. Esa lógica no garantiza una conversación exclusiva del anuncio. En estas ocho fichas no produce falsos respondidos porque no hay salientes locales; la regla general necesita anclar el mensaje de atribución al chat/conversación original antes de certificar el contador.

## Bloqueo

La ejecución nueva de node scripts/kommo-access-check.cjs devolvió KOMMO_CREDENTIALS_MISSING. No hubo petición autenticada al historial y no se puede atribuir el bloqueo a un HTTP de Kommo. Falta configurar privadamente KOMMO_BASE_URL y KOMMO_ACCESS_TOKEN como se documentó en advertising-evidence-followup-20260923.md, con permiso External chat history. No se inspeccionaron credenciales.

Se mantuvieron main y los cambios locales del compañero. Esta revisión no cambió código de negocio ni escribió datos remotos; no hubo commit, publicación, migración o recuperación. El contador no se declara resuelto.
