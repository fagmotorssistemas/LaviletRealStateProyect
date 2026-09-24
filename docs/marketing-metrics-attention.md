# Campañas y atención de contactos — 23 de septiembre de 2026

## Diagnóstico real

El proceso local y el entorno cargado por Next no contienen `META_AD_ACCOUNT_ID` ni `META_ADS_ACCESS_TOKEN`, ni sus alternativas admitidas. La comprobación imprimió solamente booleanos. No se verificó caducidad o permisos del token en Meta porque no hay token local con el que consultar. No se usó un despliegue como diagnóstico.

Configurar ambas variables en el entorno privado del servidor local (por ejemplo `.env.local`, confirmado como ignorado por Git) y reiniciar Next. Para producción se administran en Vercel → proyecto → Settings → Environment Variables → Production. No se copiaron valores desde Vercel, no se pidieron por el chat ni se modificaron archivos de credenciales. La URL cargada coincide con `xhjnyntywqhczdtecgim`.

La propiedad externa no estaba borrada: `buildMarketingFunnelReport` omitía `listActiveAdPromotedUnits` si `readAdsMarketingCredentials` devolvía null, aunque la relación estuviera disponible en Supabase. Ahora se separa la cuenta de su token; cuando falta también la cuenta, solo se permite recuperar una cuenta única de relaciones guardadas del negocio/proyecto autorizado. Una cuenta ambigua no se supone.

Una ejecución real del servicio local, con acceso a Supabase limitado a GET/HEAD y sin llamadas a Meta, recuperó para 2026-08-24–2026-09-23:

- Anuncio `52625518901665`, campaña `52625518901265`, nombre Casa De Tarqui.
- 8 contactos, propiedad externa Casa De Tarqui, USD 2,03 en caché.
- Fecha del dato guardado: `2026-09-23T14:39:54.667+00:00`; se marca pendiente de actualizar.
- Consulta del catálogo: fallida por configuración ausente; no se convierte en consulta vacía o exitosa.

Estos datos contrastan la referencia del usuario contra Supabase. **No son una nueva verificación de la campaña contra Graph.** La relación externa sigue siendo una sola fila activa y no se insertó otra.

## Catálogo y gasto

`adsCatalog.ts` consulta `/campaigns` y `/ads` de toda la cuenta, independientemente de los contactos y del período del gasto. Incluye estados pausados y archivados. Recorre `paging.next` hasta terminar; rechaza bucles y destinos fuera de Graph. No se corta después de 40 páginas. Los campos y filtros se contrastaron con el [SDK oficial de Meta](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py).

El gasto del período se consulta aparte, por anuncio. Se incorporan anuncios sin contactos y campañas sin anuncios recuperados. La jerarquía proviene de Meta o de una caché identificada como tal, nunca de una excepción para Casa De Tarqui. Un anuncio listado sin gasto disponible no se convierte automáticamente en gasto cero.

Una consulta fallida muestra «No se pudieron consultar las campañas»; una consulta completa y vacía muestra «No hay campañas para estos filtros». Se separan último intento, última consulta completa del catálogo y último dato guardado. Un error no actualiza la fecha de éxito ni sobrescribe la instantánea anterior. El gasto cacheado solo se usa para su período exacto; la jerarquía puede recuperarse de una consulta anterior para otras fechas.

## Atención y avance

La tabla principal tiene seis columnas. El detalle desplegable de cada anuncio y el resumen general comparten `marketingAttention.logic.ts`; no se genera texto con un modelo de IA. El grupo contiene personas nuevas del negocio autorizado durante el período y su evolución hasta la consulta. El origen publicitario inicial permanece único. Los contactos sin anuncio conocido tienen un grupo separado, sin gasto asignado. Las tarjetas comerciales del proyecto mantienen su alcance previo.

Fuentes: `leads`, `conversations`, `messages`, `lead_recovery`, `lead_nutrition`, tareas de seguimiento de `lv_integration_events`/`lv_outbox`, `appointments`, `unit_sales_closings`, `lead_stage_history` y `project_automation_config`. Las consultas se paginan y se limitan por negocio y por IDs autorizados. No se leen cuerpos de mensajes para clasificar el interés o inventar motivos.

- Una respuesta enviada exige estado enviado/entregado/leído o un mensaje de asesor verificado por identificador externo. También se reconoce `seller_first_response_at` guardado por la integración humana.
- En el flujo existente, `provider_status=accepted` se escribe después de `launchSalesbot`, con `delivery_confirmed=false`: **aceptar iniciar el bot no prueba una respuesta enviada**. En la inspección real había 52 filas de bot, 26 con ese estado, sin identificador externo; no se presume envío. No había eventos `advisor_outbound` ni registros de entrega de nutrición para aportar otra confirmación.
- Sin inicio y final de historial verificables, o con envíos de estado desconocido, no se afirma ausencia de respuesta ni «solo bot», y no se calcula un primer tiempo. Una respuesta positiva registrada puede reconocerse aunque el resto del historial sea incompleto.
- Un pendiente actual del equipo se distingue de nunca haber respondido: usa la derivación humana existente y, cuando el historial es evaluable, la secuencia de mensajes de la conversación atendida por el asesor. Esperar al cliente describe el último mensaje enviado sin entrada posterior; no supone pérdida de interés.
- Los tiempos de primera respuesta son minutos transcurridos desde el primer mensaje entrante verificable; bot y asesor tienen muestras y promedios separados. No equivalen al plazo hábil de atención.
- El plazo real configurado de La Vilet es 120 minutos hábiles, zona Guayaquil. Para vencimientos se utiliza `seller_response_due_at` y la regla existente de primera respuesta; no se calcula un vencimiento nuevo con un umbral inventado.
- Seguimientos: personas con al menos una tarea activa. Vencido requiere fecha programada anterior a la consulta; una tarea sin fecha no se supone vencida. La falta de respuesta no marca una pérdida.
- Compras y citas cuentan personas, no cantidad de cierres o citas. Los motivos de descarte proceden de estados/historial explícitos. No se atribuye una pérdida a una demora.

Cada porcentaje muestra numerador y base evaluable; se muestran aparte los contactos no evaluables. «Personas con algún pendiente» es la unión de IDs de primera respuesta ausente, atención humana pendiente y seguimiento pendiente. No se suman categorías solapadas. Las cifras abren sus IDs exactos, en lotes de 200 sin truncar el conjunto; el servidor vuelve a validar acceso CRM, negocio y proyecto, y enmascara teléfonos. Desde allí se abre la ficha existente.

## Migraciones revisadas y aplicadas

Se comprobó que los objetos de las dos migraciones pendientes no existían antes de aplicarlos mediante MCP. Se aplicaron una vez y se verificaron después:

- `20260923163750_atomic_ad_property_identification.sql`: función de corrección atómica, sin borrar relaciones ni modificar permisos de la tabla anterior.
- `20260923163751_marketing_ad_interactions.sql`: tabla y función para conservar referencias publicitarias por mensaje.

Los nombres locales se alinearon con las versiones devueltas por el registro remoto para no presentar estas dos migraciones como pendientes otra vez. `anon` y `authenticated` no pueden ejecutar ninguna de las dos funciones. La tabla nueva tiene RLS y esos roles no pueden leerla; `service_role` tiene el acceso necesario. No se ejecutó una corrección de propiedad de prueba sobre datos reales ni se enviaron mensajes o eventos a Meta. No se cambió Nest ni las reglas comerciales.

El analizador de Supabase informa [RLS habilitado sin políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) para la tabla nueva: es intencional en este caso, porque el acceso es exclusivo del servidor y no se concedieron permisos a clientes. No se añadió una política permisiva para ocultar el aviso.

## Validación y pendientes

Validación final: 83 pruebas relevantes aprobadas; 67 ayudas comprobadas en navegador con escritorio, móvil y teclado. `npm run build`, `npx tsc --noEmit --incremental false` y ESLint sobre los archivos revisados terminaron correctamente. Después del ajuste de precisión temporal se repitieron y aprobaron los cinco casos de cuenta y persistencia de adquisición.

En la consulta real del período indicado se recuperaron 23 contactos nuevos: 8 con anuncio conocido y 15 sin anuncio. Para 22 no había evidencia suficiente para determinar la primera respuesta; para uno existía una respuesta de asesor registrada. Esto no demuestra que los otros 22 estén desatendidos.

Pruebas aisladas: catálogo vacío/fallido, cuenta incorrecta, permisos rechazados, más de 40 páginas, estados pausados/archivados, gasto sin contactos, caché y fechas; mensajes fallidos/en cola/aceptados sin envío, solo bot enviado, asesor, nueva pregunta después de respuesta, historial incompleto, seguimiento vencido, unión sin duplicados y base cero. PGlite prueba persistencia y permisos. Se conservan microsegundos al elegir el primer origen; truncarlos a milisegundos podía invertir dos capturas muy próximas.

El navegador usa datos y acciones simulados: comprueba ayudas en escritorio/móvil/teclado, detalle por anuncio, cifras y ficha correspondiente, guardado/recarga de propiedad y los mensajes de fallo del catálogo. No equivale a una sesión autenticada real ni a consultar Meta.

Pendientes externos concretos: configurar las credenciales locales, reiniciar Next y repetir la consulta real de catálogo/jerarquía/gasto en Graph. Para medir respuestas antiguas del bot se necesitan evidencias de envío que hoy no están guardadas; no se reconstruyeron ni se cambiaron los envíos para producirlas. El código permanece local en `main`, sin push ni despliegue.
