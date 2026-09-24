# Identificación de propiedades anunciadas

Cambios locales en `main`. No se integró la propuesta #7 ni se hizo push o despliegue. Se conservaron los textos claros y las ayudas accesibles.

## Comportamiento

- Una relación vigente en `meta_ad_promoted_units`, del mismo tenant, proyecto y cuenta publicitaria, tiene prioridad.
- Sin relación, se consultan los destinos del creativo del anuncio. Solo se reconoce automáticamente una URL HTTPS de `lavilett.com` o `www.lavilett.com` con ruta `/tour/unidad/<UUID>` y una unidad existente en el inventario autorizado. Se reconocen destinos en enlaces, carruseles, llamadas a la acción y variantes del creativo. Los campos se contrastaron con el [SDK oficial de Meta](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adcreative.py).
- Si Meta no devuelve destinos, se pueden comprobar los enlaces originales guardados en la atribución del anuncio, después de verificar su cuenta. No se rastrean redirecciones ni se deduce por nombre, imagen, número mencionado en un texto o intereses posteriores del contacto.
- Todos los destinos deben ser reconocibles. Un conjunto de enlaces parcialmente desconocido queda pendiente de identificación. Varios destinos inequívocos se muestran juntos; no se distribuye ni se repite el gasto por unidad.
- El usuario puede confirmar una o varias unidades y/o propiedades externas, con un motivo. Guardar reemplaza el conjunto anterior de forma atómica y conserva las filas anteriores, autor y fechas. La función rechaza una edición basada en un estado que otro usuario ya corrigió.
- La pantalla principal muestra campañas → anuncios de toda la cuenta conectada. No hay pestañas ni filtros por clasificación de propiedad. Incluye anuncios sin contactos y no filtra por estado activo: campañas pausadas o archivadas con actividad en las fechas seleccionadas se conservan. La propiedad es una columna adicional. Las páginas repetidas de Meta no duplican el gasto. Una respuesta parcial conserva las filas recuperadas y señala cobertura incompleta.
- Costo promedio por contacto = gasto del anuncio ÷ contactos nuevos únicos atribuidos a su primer origen publicitario guardado. Los totales dividen sumas, no promedios. Con gasto y cero contactos: «Sin contactos nuevos»; sin gasto: «No disponible». No se asignan costos individuales ni se reparte gasto entre propiedades.
- La actividad general del CRM se conserva y está rotulada «todos los orígenes». Los contactos sin anuncio conocido no entran en los promedios publicitarios. Un contacto de un anuncio externo puede seguir interesado en La Vilet. No se modifica `lead_units`, el proyecto del contacto, Nest ni los envíos de Meta.

## Efecto de las correcciones

Los informes se reconstruyen con la **identificación actual**, también al consultar fechas anteriores. Una corrección cambia la etiqueta de propiedad, sin alterar las campañas, el gasto, los contactos ni los promedios publicitarios. No altera las fechas de los indicadores. No se implementa una fotografía histórica del informe tal como se veía antes de corregirlo. El historial de relaciones permanece en la tabla; el diálogo muestra los últimos 100 vínculos.

## Comprobación real mediante MCP

En `xhjnyntywqhczdtecgim`, el anuncio `52625518901665` tenía caché en la cuenta `act_1042972075196209`, atribuciones del proyecto La Vilet y enlaces de Facebook/Instagram que no identificaban una unidad. No existía una relación vigente.

Por la confirmación explícita del responsable transmitida por el usuario, se guardó **Casa De Tarqui** como externa, sin excepción en el código. Relación: `e70baeab-993e-498d-9567-4aebe9db3901`. Se dejó nota de la autorización administrativa y `assigned_by = NULL`: no se simuló una sesión de un usuario del CRM.

La segunda lectura confirmó una sola relación activa y los mismos **8 contactos** en el CRM antes y después. RLS sigue habilitado, sin políticas; `anon` y `authenticated` siguen sin acceso a la tabla. No se ampliaron permisos. La cuenta del anuncio se contrastó con la caché existente, no mediante una nueva llamada Graph desde esta sesión.

## Estado de migraciones y límites

La migración incremental `20260923163750_atomic_ad_property_identification.sql` fue probada localmente y **aplicada mediante MCP el 23 de septiembre**, tras comprobar que la función no existía. Añade únicamente la función de corrección atómica; no borra datos ni cambia los permisos de la tabla. El botón de guardar ya dispone de la función remota; aún requiere sesión y conexión autorizada con Meta. La relación real de Casa De Tarqui ya funciona con la tabla existente.

La función es `SECURITY INVOKER`, ejecutable solo por `service_role`. La acción del servidor valida sesión, permiso de escritura, tenant, proyecto, cuenta del anuncio en Meta y unidades. No requiere acceso de lectura a `auth.users`, que la comprobación remota mostró que `service_role` no tiene; conserva las claves foráneas de autor existentes. Un fallo de cuenta o de permisos de Meta bloquea la confirmación, en vez de guardar sin verificar. Las relaciones antiguas sin cuenta publicitaria requieren revisión antes de reemplazarlas.

La nueva consulta de destinos de creativos no se ha probado contra Graph en vivo en esta sesión. Enlaces acortados, enlaces sociales, rutas no admitidas, anuncios sin destino o destinos de otra unidad/proyecto no se clasifican automáticamente. Las identificaciones por enlace se vuelven a evaluar al consultar; las confirmaciones guardadas prevalecen y persisten.

## Validación aislada y reproducible

Se usan datos ficticios; ninguna de estas pruebas envía eventos a Meta ni modifica la base remota:

```powershell
node --require ./scripts/test-typescript.cjs --test scripts/marketing-funnel.logic.test.cjs src/lib/meta/adsCampaignRollup.test.ts src/lib/meta/adPromotedUnitsIsolation.test.ts src/lib/meta/adPropertyIdentification.test.ts src/lib/meta/adPromotedProperties.pglite.test.ts scripts/marketing-properties.actions.test.cjs
node scripts/marketing-metrics.browser.test.cjs
npx tsc --noEmit --incremental false
```

Las pruebas cubren identificación inequívoca, destinos ambiguos o ajenos, externos, grupos múltiples, deduplicación y promedios. PGlite ejecuta las migraciones y comprueba persistencia, historial, rechazo de ediciones desactualizadas, reversión ante errores y permisos. Las acciones se prueban con sesión, cuenta y base simuladas. El navegador verifica escritorio/móvil, 52 ayudas accesibles, todas las clasificaciones juntas, anuncios sin contactos y guardado/recarga con persistencia simulada en memoria del navegador. Esto no equivale a probar una sesión real de usuario con Graph y la migración desplegada.

## Identidad y adquisición: aclaraciones del 23 de septiembre

La inspección real de `register_inbound_message` confirmó que ya reutiliza la ficha por `(tenant_id, phone_normalized)`, mediante un índice único. No se sustituyó esa función ni se fusionaron históricos. El informe usa el ID estable de esa ficha, no el nombre ni el número de mensajes. En la base real hay 36 fichas, todas con teléfono normalizado, y cero grupos duplicados por esa identidad. Existe además un índice único por negocio e identificador de WhatsApp.

El punto de pérdida encontrado está en `lv_app_preserve_ctwa`: conserva una sola captura por proyecto/contacto de Kommo. Además, el ingreso existente actualiza `leads.contact_id` cuando cambia el contacto de Kommo, por lo que consultar solo ese campo podía ocultar el origen anterior. La solución local guarda cada referencia publicitaria disponible en `marketing_ad_interactions`, vinculada a la ficha y al mensaje persistido. El servidor comprueba negocio, proyecto, conversación, contacto y mensaje. Los reintentos no duplican interacciones. La primera referencia guardada se obtiene comparando las capturas anteriores y el historial nuevo; la fecha original de un mensaje tardío no reemplaza una captura guardada antes.

Los puntos de entrada modificados son `conversation.ts:register` y `generation-recovery.ts:recoverGenerationFailure`, después de registrar el mensaje. Se conserva el contrato de la captura usada por Meta. Una referencia explícita con `source_type=ad` e identificador numérico se registra aunque no traiga identificador de clic; no se fabrica ese identificador ni se habilitan envíos. Si falla la escritura adicional, queda el código seguro `marketing_ad_interaction / PERSIST_FAILED` en el registro de errores, sin interrumpir la atención.

El informe publicitario consulta contactos nuevos de todo el negocio autorizado, independientemente del proyecto elegido. Recupera también los identificadores anteriores de Kommo desde las conversaciones de la misma ficha; si una asociación es ambigua, no la inventa. Los contactos se filtran por la fecha original de creación de la ficha en hora de Guayaquil; el gasto utiliza las fechas seleccionadas según la zona horaria de la cuenta Meta. Una persona registrada antes del período no se convierte en nueva adquisición por una interacción posterior. Las tarjetas generales del CRM y la tabla de interés en unidades siguen correspondiendo al proyecto seleccionado; no se escribe en `lead_units`.

### Evidencia real adicional, solo lectura

- Casa De Tarqui mantiene una clasificación externa activa y 8 contactos. La caché del anuncio registra USD 2,03 para 2026-08-24 a 2026-09-23 (y para la consulta anterior 2026-08-23 a 2026-09-22). Son snapshots de períodos superpuestos: no se suman entre sí ni se presentan como consulta nueva a Meta.
- Se verificaron 8 vínculos entre atribuciones guardadas y conversaciones de WhatsApp.
- `meta_ad_promoted_units` conserva RLS habilitado, cero políticas, sin SELECT/INSERT/UPDATE/DELETE para anon y authenticated; service_role conserva esos permisos.
- En la primera revisión no existía la tabla nueva. En la revisión posterior se aplicaron las dos migraciones autorizadas; véase marketing-metrics-attention.md.

### Migraciones y límites concretos

Además de la migración de identificación ya pendiente, `20260923163751_marketing_ad_interactions.sql` prepara tabla e inserción validada de interacciones, con RLS y acceso exclusivo de service_role. No borra ni fusiona registros. Ambas migraciones se aplicaron en la revisión posterior, con permisos verificados y versiones locales alineadas con el registro remoto. No se reconstruyeron interacciones históricas ausentes.

No se ha hecho una consulta nueva a Graph ni una prueba de ingreso real por Kommo en esta sesión. La pantalla no puede conocer visualizaciones individuales ni referencias que Kommo no entregue. No se reconstruyeron automáticamente interacciones históricas descartadas por la captura anterior. No se modificó Nest, consentimiento ni envío de eventos a Meta.

### Pruebas nuevas simuladas

`marketingAcquisition.pglite.test.ts` ejecuta una copia de solo lectura de las funciones reales de normalización/ingreso en PostgreSQL aislado y la migración nueva: dos entradas, mismo teléfono con formatos distintos y distintos identificadores Kommo/anuncios, una ficha, dos mensajes, dos interacciones, una adquisición. Comprueba reintentos, teléfono distinto, restricciones de acceso y rechazo de enlaces de mensaje incorrectos. No es una prueba de producción.

`marketingAccount.test.ts` prueba paginación de Meta simulada sin filtro de estado activo, anuncios sin contactos, externos, varios anuncios por campaña, gasto único y promedio calculado sobre sumas. `marketing-interaction-store.test.cjs` comprueba el enlace entre la captura y la nueva función sin alterar el contrato anterior.

```powershell
node --require ./scripts/test-typescript.cjs --test src/lib/meta/marketingAccount.test.ts src/lib/meta/marketingAcquisition.pglite.test.ts scripts/marketing-interaction-store.test.cjs scripts/ctwa-kommo.test.cjs
```

Estado más reciente, diagnóstico de conexión y métricas de atención: [marketing-metrics-attention.md](marketing-metrics-attention.md).
