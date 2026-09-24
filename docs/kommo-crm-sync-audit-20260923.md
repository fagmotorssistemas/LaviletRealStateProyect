# Auditoría Kommo → CRM → métricas — 23/09/2026

## Estado: corrección local; conciliación original bloqueada

Se trabajó en `main`, sin ramas, commit, push ni despliegue. Se conservaron los cambios locales anteriores. **Esta auditoría no declara resuelta la sincronización.** No hay `KOMMO_BASE_URL` ni `KOMMO_ACCESS_TOKEN` en el entorno local cargado por Next. Solo se imprimieron booleanos; no se inspeccionaron almacenes privados ni valores de secretos. Las lecturas reales de Supabase corresponden a `xhjnyntywqhczdtecgim`.

Alcance inicial: negocio `a1b2c3d4-0001-4000-8000-000000000001`, cuenta esperada Kommo `36919007` (`lavilet.kommo.com`), WhatsApp/WABA; desde 24/08/2026 00:00 hasta 24/09/2026 00:00, límite final exclusivo, America/Guayaquil. Las fechas de creación del CRM y de Kommo se comparan por separado. El usuario puede ampliar el período; no se presupone que una persona antigua que vuelve a escribir sea una adquisición nueva.

## Lecturas reales, sin escrituras

Inventario completo del CRM mediante `scripts/kommo-crm-audit.cjs`, paginado por IDs, además de contrastes SQL sobre todos los registros. Observación alrededor de 17:47–18:00 UTC del 23/09; no es una instantánea transaccional de ambos proveedores.

| Comprobación | Resultado real |
|---|---:|
| Fichas CRM del negocio | 36 |
| Creadas en el período | 23 |
| Personas anteriores con mensajes en el período | 1 |
| Conversaciones guardadas | 24, canal WhatsApp |
| Mensajes guardados | 156: 102 cliente, 54 bot, 0 asesor |
| Eventos entrantes recorridos | 752 |
| Fichas con IDs tanto de contacto como comerciales | 20 |
| Solo ID comercial | 1 |
| Sin ambos IDs Kommo | 15 |
| Duplicados CRM por teléfono normalizado, contacto o ficha Kommo | 0 en cada comprobación |
| IDs originales de mensaje duplicados | 0 |
| Eventos entrantes sin mensaje correspondiente | 678 |
| De esos 678, marcados como reinicios manuales | 676; no restaurar automáticamente |
| De esos 678, completados como `outside_test_lead` | 2 |
| Mensajes con fecha distinta de su evento entrante conservado | 0 |
| Mensajes cuya identidad de origen difiere de la identidad actual CRM | 25, en una misma ficha |
| Contactos Kommo comparados directamente por API | **0: acceso ausente** |
| Contactos faltantes respecto de TODO Kommo | **No determinable** |
| Conversaciones verificadas completas contra Kommo | **0** |

Los dos eventos completados sin mensaje son:

| Evento | Ficha Kommo | Contacto Kommo | Situación CRM |
|---|---:|---:|---|
| `70e47682-a737-4e74-b0ec-ac8b2c35399e` | 4536654 | 9539622 | No hay ficha CRM con esos identificadores |
| `98be37e2-a415-46c9-abc7-b30746fa7ba5` | 4453096 | 9431328 | Pablo confirmado interno |

Esto prueba una diferencia entre eventos recibidos y mensajes conservados; no prueba por sí solo por qué se perdió cada registro. El código local actual ya registra antes del filtro `test_only`; no se atribuye retrospectivamente el incidente a esa versión sin logs del despliegue que lo procesó. No se reactivaron eventos cancelados ni se llamó al worker para recuperarlos.

Los 25 mensajes con identidades distintas pertenecen a CRM `bf32833f-fd65-461e-9e0e-31844e4d6814`. Sus eventos identifican contacto `8715920` / ficha `3928256` y la conversación conserva `external_thread_id=8715920`; la ficha CRM actual identifica contacto `9452332` / ficha `4469212`. Puede ser reutilización legítima por teléfono o un enlace incorrecto: falta contrastar ambas identidades originales. No se fusionó ni reasignó nada.

## Los ocho de la captura

Se contrastaron los ocho, no se tomaron como respuestas válidas por aparecer en pantalla:

| Ficha comercial Kommo | Contacto Kommo | Salidas locales |
|---:|---:|---:|
| 3401838 | 7732504 | 1 |
| 4453798 | 9431950 | 1 |
| 4454162 | 9432278 | 5 |
| 4429474 | 9406018 | 1 |
| 4453354 | 9431562 | 12 |
| 4469212 | 9452332 | 14 |
| 4453096 | 9431328 | 1 |
| 3587844 | 8123818 | 18 |

Estas 53 salidas no tienen ID externo. En las 54 salidas de todo el CRM, 28 tienen `provider_status=accepted` y 26 no tienen estado. El flujo `launchSalesbot → register_outbound_message` guarda contenido generado tras aceptar el lanzamiento, sin confirmar entrega. **No se afirma que esos mensajes no se enviaron; no hay evidencia suficiente para contarlos como enviados.**

Ejecución real, de solo lectura, del servicio corregido: 23 personas con nombre disponible y 23 historiales incompletos. Ninguna respuesta de este grupo satisface la evidencia de envío disponible actualmente; ninguna persona se clasifica por ello como nunca atendida o pendiente del asesor. La interfaz muestra «Sin información suficiente», no un cero concluyente.

## Puntos comprobados del recorrido y correcciones locales

1. `webhook.ts` descartaba autores distintos de `internal` o sin ID numérico antes de crear `advisorOutbound`. Esto excluye a Salesbot y autores sin ese auxiliar del camino de almacenamiento. El receptor podía contestar 200 sin persistir esas salidas. No se deduce de ello cuántos webhooks así recibió producción: faltan los logs de entrada anteriores al filtro.
2. La ruta de recepción dependía del interruptor comercial `settings.live`. Se añadió un registro de evidencia idempotente previo a la ejecución comercial; con automatización apagada guarda evidencia y termina sin encolar ni despertar bots. También se corrigió el doble conteo de `message[add]` al limitar el tamaño del lote.
3. El registro independiente conserva ID de mensaje, contacto, ficha comercial, chat, conversación, autor, medio, contenido, fecha original, fecha de observación, procedencia y estado. Las referencias de identidad incompatibles quedan sin vínculo: no usa `OR ... LIMIT 1`, nombres o coincidencias de texto para elegir persona.
4. La clasificación del autor usa evidencia del proveedor. Un error explícito prevalece sobre la mera existencia de contenido. Se aceptan envíos comprobados sin texto, incluidos audio/imagen/documento; no se exige lectura. No se confunde `accepted` del lanzamiento del bot con `sent` del mensaje.
5. La ficha CRM combina mensajes existentes con el registro independiente mediante una acción del servidor que valida permiso CRM, fila accesible por RLS, negocio y proyecto. Deduplica por ID externo y conserva los borradores ya guardados como historial, sin convertirlos en envíos.
6. Métricas separa respuesta enviada, espera actual comprobada, ausencia comprobada e historial incompleto. Una respuesta positiva puede coexistir con historial incompleto. No se inventa autor ni un pendiente humano por silencio. Cada contador utiliza sus IDs exactos y muestra nombre y ficha comercial; los vínculos históricos se señalan pendientes de contrastar.
7. El modelo conserva la primera adquisición publicitaria. La clasificación interna se consulta de un historial persistente, no de una lista fija en código. Excluye personas confirmadas de los conjuntos comerciales; no excluye campañas ni altera el gasto de Meta.

El procedimiento antiguo `lv_record_advisor_outbound` también usa búsqueda `OR ... LIMIT 1`, asignación alternativa al asesor de la ficha y comparación de texto ±5 minutos para omitir entregas del bot. Se documenta como riesgo adicional. **No se usa ese procedimiento para recuperar historia**, porque además pausa bots y cambia estados. Sus reglas comerciales existentes no se modificaron; el registro nuevo conserva evidencia antes de ese camino.

## Retrasos y actualización automática

Sobre 76 eventos entrantes completados: origen → recepción mediana **2,679 s**, p95 **3,989 s**; recepción → finalización mediana **66,298 s**, p95 **104,558 s**. La última finalización entrante observada fue `2026-09-23T16:36:45.16209Z`. Son demoras del procesamiento existente, no prueba de integridad del historial. Dos eventos completados no tienen mensaje conservado, por lo que `completed_at` no basta como marca de sincronización exitosa.

El código nuevo distingue hora de consulta, almacenamiento comprobado por dirección y retraso origen → almacenamiento de observaciones de webhook. Las recuperaciones históricas no se mezclan en esa muestra de demora. Si no hay registro de evidencia, no se anuncia sincronización exitosa. Una recarga de pantalla no prueba recepción. **La actualización automática real de entrantes y salientes queda sin verificar** hasta tener acceso, aplicar lo aprobado y autorizar el despliegue; no se enviaron mensajes de prueba.

## Recuperación preparada y alcance para aprobación

**Nada de este apartado se aplicó a producción.**

- Migración local `20260923174920_kommo_message_evidence.sql`: registro independiente, clasificación auditable y funciones exclusivas de `service_role`; RLS activo, sin lectura/escritura/ejecución de clientes. No borra, fusiona o modifica contactos, conversaciones, mensajes, `lead_units`, consentimiento, estados comerciales ni Meta. Debe aplicarse antes de desplegar la ruta nueva: sin la función, el receptor falla con 503 para no confirmar datos que no pudo guardar.
- Clasificación de **una** persona: `operations/kommo-internal-classification-review.sql`, por negocio + ficha `4453096` + contacto `9431328`, CRM `e49607f2-ba8d-4a2b-a607-85617072800c`. El script termina en `ROLLBACK` para revisión. Resultado esperado al aprobarla: conservar íntegro el CRM y excluir a Pablo de las métricas comerciales. En el período auditado, el conjunto nuevo pasaría de 23 a 22. El compañero queda sin excluir hasta identificarlo exactamente. Casa De Tarqui conserva su campaña, contactos comerciales y gasto.
- La clasificación es histórica y auditable; una corrección añade otra fila. Los informes anteriores se recalculan usando la clasificación vigente al consultar. Se explica este efecto: no es una foto congelada de la clasificación pasada.
- `node scripts/kommo-crm-audit.cjs`: solo GET a Kommo y SELECT a Supabase. Recorre contactos, fichas, conversaciones y mensajes de todas las páginas, sin filtrar exclusivamente por fichas conocidas. Separa toda la cuenta del subconjunto WhatsApp/WABA y personas nuevas de antiguas activas. Contrasta teléfono normalizado y las relaciones en ambos sentidos; reporta conflictos y duplicados, no los fusiona.
- Si el acceso lo permite, genera comparación y un plan de recuperación fuera del repositorio, en una carpeta temporal privada, conservando fechas, autores, IDs y estados originales. Excluye identidades no verificadas y eventos marcados como reinicios manuales. No escribe el plan en producción ni llama a RPC comerciales. El número exacto y los IDs a recuperar deben revisarse **después** del contraste original y **antes** de aprobar esa recuperación. Hoy no existe un plan de recuperación original completo porque faltan las credenciales.
- Los 676 eventos anulados manualmente quedan fuera. La ficha ausente `4536654` requiere verificar contacto/teléfono antes de crear o vincular una persona. Las identidades históricas divergentes requieren resolver sus enlaces; el registro no convierte coincidencias ambiguas en asociaciones nuevas.
- No se marca una conversación como completa únicamente por leer todas las filas locales o por recibir un webhook nuevo. La certificación de cobertura completa por conversación queda pendiente del contraste original; hoy se mantiene desconocida en el servicio.

## Accesos concretos pendientes

Configurar en el entorno privado local del servidor (por ejemplo `.env.local`, ya ignorado por Git), sin enviarlos al chat:

- `KOMMO_BASE_URL=https://lavilet.kommo.com`.
- `KOMMO_ACCESS_TOKEN` con acceso de lectura a toda la cuenta y alcance **External chat history**. El historial también depende del plan y derechos del usuario; 402/403 se reportan por conversación y no se convierten en historial vacío.
- Logs autorizados de la función de producción `/api/integrations/kommo/webhook` y del ejecutor: fecha, versión desplegada, correlación, resultado HTTP y motivo de rechazo antes de la persistencia. No hacen falta secretos ni URL con clave. No hay una herramienta de logs de Vercel disponible en esta sesión.
- Confirmar que la suscripción de la cuenta incluye `outgoing_message`; no se modificó la configuración de webhooks desde aquí. Los mensajes originados desde WhatsApp solo pueden recuperarse si Kommo los refleja en su historial accesible.

Fuentes oficiales: [notificación de mensajes salientes](https://developers.kommo.com/docs/webhooks-general), [listado de conversaciones](https://developers.kommo.com/reference/get-talks), [historial y permiso External chat history](https://developers.kommo.com/reference/get-conversation-messages), [contactos y relaciones comerciales](https://developers.kommo.com/reference/contacts-list). El webhook CRM de salida se distingue del callback de transporte Chats API: no se trata cualquier petición de transporte como entrega.

## Validación

- Datos reales: inventario paginado completo del CRM, consultas cruzadas de identidades/eventos/mensajes, investigación de los ocho, retrasos y lectura del servicio corregido sin escrituras. La comparación Kommo no se ejecutó y no se sustituye por capturas.
- Pruebas aisladas: paginación, IDs diferentes, teléfonos incompatibles, exclusión de reinicios manuales, autor bot/desconocido, multimedia, borrador/fallo/cola, primera respuesta vs nueva pregunta, historial incompleto, base cero, persistencia idempotente, permisos y ausencia de efectos comerciales. PGlite ejecuta la migración en memoria; no demuestra que esté aplicada en Supabase.
- Pasaron 63 casos relevantes en una ejecución conjunta y el caso adicional de contraste de fecha, autor y dueño de mensajes ya existentes (64 casos distintos). El build final, TypeScript y ESLint de los archivos revisados pasaron. Los resultados de pruebas no sustituyen el contraste con Kommo.
- Navegador simulado en escritorio/móvil: conjuntos exactos al pulsar, nombres, enlace a la ficha comercial correcta del ejemplo, evidencia multimedia e historial incompleto. No es una sesión Kommo real.
- La prueba anterior `marketing-metrics.browser.test.cjs` falla porque el `MetricHelp.tsx` local ya devuelve `null`. Se preservó ese archivo del compañero; no se declara que las ayudas pasen en este estado.

La corrección no debe darse por cerrada sin la conciliación con Kommo, revisión de los vínculos divergentes y verificación posterior de recepción automática real.
