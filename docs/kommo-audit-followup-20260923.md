# Continuación de auditoría — 23 septiembre 2026

Estado: abierto. Solo lecturas remotas. Main, sin commit, push, despliegue, aplicación de la migración ni recuperación. Este informe complementa `kommo-crm-sync-audit-20260923.md`; sus conteos son cortes distintos de una base que sigue cambiando.

## Migración pendiente y permisos

Archivo: `supabase/migrations/20260923174920_kommo_message_evidence.sql`.

| Objeto nuevo | Finalidad | anon / authenticated / PUBLIC | service_role |
|---|---|---|---|
| kommo_message_evidence | Evidencia original, fecha, autor, identidad, multimedia y estado | Sin permisos; RLS activado, sin políticas cliente | SELECT, INSERT; sin UPDATE, DELETE o TRUNCATE |
| crm_contact_classifications | Historial de clasificación comercial/interna | Sin permisos; RLS activado, sin políticas cliente | SELECT; escritura mediante función |
| lv_record_message_evidence(jsonb) | Guarda evidencia idempotente; identidades ambiguas quedan sin vincular | Sin EXECUTE | EXECUTE; SECURITY INVOKER |
| classify_crm_contact(uuid,uuid,text,text,text) | Añade clasificación con motivo y responsable; comprueba ficha y negocio | Sin EXECUTE | EXECUTE; SECURITY DEFINER |

No reemplaza tablas o funciones actuales, no crea disparadores y no inserta clasificaciones ni recupera mensajes. Incluye índices y claves foráneas. Las claves pueden impedir borrar fichas/proyectos/negocios con evidencia dependiente; no borran en cascada.

La inspección real de `pg_default_acl` encontró permisos amplios de tablas para service_role. Se corrigió el borrador local para revocarlos explícitamente antes de conceder los mínimos; un GRANT reducido por sí solo no los retiraba. La prueba PGlite ahora reproduce esos permisos iniciales y comprueba que no quedan UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER ni INSERT directo de clasificaciones. No se modificaron permisos en producción.

Aplicar solo el esquema no cambia el ejecutor actual. **Desplegar el código local sí cambia la recepción:** el webhook guarda evidencia antes de encolar el procesamiento comercial; si falta la función o falla su escritura, devuelve 503. Por eso no debe desplegarse antes del esquema y la validación de acceso. Con automatización desactivada registra evidencia, pero no encola acciones. No llama a bots, envíos Meta ni funciones comerciales para recuperar datos. La clasificación bloquea brevemente la ficha durante la transacción. El motivo y responsable son aportados por el operador del servidor, no inferidos de auth.uid.

La migración no desactiva las funciones destructivas de reinicio existentes. No basta aplicarla para resolver esa causa.

## Relación 4453096 / 9431328

La ficha CRM `e49607f2-ba8d-4a2b-a607-85617072800c`, Pablo Andrés Márquez, contiene ficha comercial Kommo 4453096 y contacto 9431328. Siete eventos recibidos con esa ficha llevan ese mismo contacto. Esto confirma coherencia en los datos recibidos y almacenados; **falta confirmar la relación original en ambos sentidos con Kommo**.

Seis respaldos antiguos de Pablo contienen ficha 3577404 y contacto 8105914, con el mismo teléfono normalizado de la ficha CRM actual. No se confunden los dos tipos de ID ni se cambia la vinculación basándose en el nombre. Su clasificación interna continúa pendiente de aplicar el mecanismo revisado; no se ejecutó el SQL de clasificación. El compañero sigue sin identificación exacta. Casa De Tarqui no se excluye y el gasto Meta no se altera.

## Reinicios: 676 pasó a 684

El corte posterior encontró 684 eventos entrantes cancelados sin mensaje actual: 679 con `manual_test_lead_reset` y cinco con `lead_reset_by_user`. Hay respaldos nuevos de 23 septiembre a las 20:16:04 y 20:41:25 UTC (15:16 y 15:41 Ecuador), posteriores a la primera auditoría. No son 684 personas ni 684 reinicios.

Se revisaron 116 versiones de `lv_manual_test_reset_backups`. Los 679 eventos manuales aparecen con contenido original en alguna versión; 677 tienen también mensaje guardado con su ID original en algún respaldo. Los otros dos estaban pendientes antes de cancelarse: `78a977fe-b843-43fa-9cc2-f1de886db759` y `e18433af-e94e-4181-8f20-e9d947528204`, ficha 2710090/contacto 6431312. Por tanto, no todos los eventos sin mensaje representan un mensaje borrado: algunos nunca llegaron a persistirse.

Los cinco `lead_reset_by_user` tienen payload vacío y no tienen correspondencia en estos respaldos; `lv_test_backups` está vacío. No se identificó todavía su ejecutor ni una copia recuperable. Un último respaldo vacío no prueba pérdida total: los reinicios repetidos reemplazan el backup_id del resultado del evento, y es necesario recorrer todas las versiones.

La función vigente `lv_reset_lavilet_test_contact(integer)` guarda un respaldo y luego borra mensajes, conversaciones, citas y sus dependencias, intereses de unidades, interacciones, financiación, puntuaciones/historiales y colas de automatización, entre otros. Cancela eventos y retira gran parte del payload. Reinicia campos comerciales, asignación y respuesta; pone `tracking_consent=false` y `bot_enabled=true`. No elimina la ficha ni llama directamente a Kommo/Meta, pero sí afecta el procesamiento posterior. No se ejecutó ninguna de estas funciones.

Los cuatro reinicios manuales no tienen EXECUTE para anon, authenticated o service_role: requieren un rol de base privilegiado. La función antigua `lv_test_reset(text)` tiene EXECUTE amplio, pero es SECURITY INVOKER, exige modo test/dry_run y acceso a tablas no concedido a clientes; no borra mensajes/conversaciones y no explica los 679. No se deduce una vulnerabilidad solo por ese EXECUTE.

Prevención propuesta, todavía sin aplicar: retirar los reinicios destructivos del uso en producción; usar conversaciones de prueba aisladas; conservar evidencia inmutable y exigir vista previa, responsable y respaldo verificable para cualquier limpieza. No reiniciar consentimiento o habilitación del bot como efecto de una limpieza. No actualizar los IDs antiguos de los reinicios de Pablo/Nataly para hacerlos funcionar: ahora sus comprobaciones de identidad impiden usarlos sobre las fichas actuales. Atención: los archivos `supabase/operations/reset_test_lead.sql` y `reset_nataly_test_lead.sql` incluyen llamadas ejecutables, no son solo definiciones.

## Dos eventos completados sin mensaje

| Evento | Ficha / contacto | Recepción UTC | Evidencia |
|---|---|---|---|
| 70e47682-a737-4e74-b0ec-ac8b2c35399e | 4536654 / 9539622 | 20 septiembre 16:21:26 | outside_test_lead; sin message_persisted ni mensaje en respaldos |
| 98be37e2-a415-46c9-abc7-b30746fa7ba5 | 4453096 / 9431328 | 21 septiembre 14:52:10 | outside_test_lead; sin message_persisted ni mensaje en respaldos |

El código anterior al commit 5ed8671 devolvía `outside_test_lead` antes de `register(events,guard)`. Ese commit, del 21 septiembre 16:54 UTC, posterior a ambos eventos, movió el registro antes del filtro y añadió `message_persisted:true`. El código actual ya conserva ese orden. Es una explicación respaldada por código y cronología; faltan versión desplegada y logs por solicitud para confirmar exactamente qué código produjo cada evento. No se atribuyen estos dos casos a los reinicios sin evidencia.

## Veinticinco mensajes con identidad distinta

Pertenecen a la ficha CRM `bf32833f-fd65-461e-9e0e-31844e4d6814`: conversación antigua ficha 3928256/contacto 8715920, mientras la ficha actual tiene 4469212/contacto 9452332. Seis respaldos de la identidad anterior coinciden en teléfono normalizado con la actual.

La función real `register_inbound_message` reutiliza la ficha mediante conflicto `(tenant_id, phone_normalized)` y actualiza contact_id/kommo_id con los nuevos valores; la conversación anterior mantiene su external_thread_id. Ese mecanismo explica la discrepancia sin demostrar por sí mismo una mezcla de personas. Falta verificar ambos contactos y sus relaciones originales en Kommo. No se fusionó, borró o reasignó ningún histórico.

## Acceso privado a Kommo y comprobación

1. Un administrador autorizado debe usar una integración privada existente o crear una para la auditoría en Configuración → Integraciones. Debe conceder acceso a contactos/fichas y **External chat history**, con visibilidad suficiente de toda la cuenta. Si cambia permisos de una integración, reautorizarla; un token anterior puede mantener permisos anteriores. No se necesita conceder envío a chats para esta lectura.
2. En el editor local, añadir a `.env.local` sin reemplazar su contenido existente: `KOMMO_BASE_URL=https://lavilet.kommo.com` y `KOMMO_ACCESS_TOKEN=<token autorizado>`. No usar prefijo NEXT_PUBLIC, no pegar el token en el chat, no ponerlo en argumentos del terminal ni en Git. Se comprobó que `.env.local` está ignorado. No se leyó su contenido. El cargador normal de entorno comprueba disponibilidad sin mostrar valores.
3. Ejecutar `node scripts/kommo-access-check.cjs`. Solo hace GET: valida cuenta 36919007, comprueba el vínculo ficha/contacto en ambos sentidos, recorre conversaciones visibles y prueba el historial de una conversación. Solo muestra IDs, cantidades y estados; no contenido ni secretos. Esa muestra **no certifica cobertura completa**.
4. Si el acceso funciona, continuar con `node scripts/kommo-crm-audit.cjs`, que pagina la comparación completa y prepara archivos de revisión, sin recuperar ni escribir remotamente. Debe revisarse la cobertura real de canales y permisos antes de declarar completa la comparación.

Hoy el comprobador termina con `KOMMO_CREDENTIALS_MISSING`: no se consultó el historial original. GET `/api/v4/talks/{talk_id}/messages` requiere External chat history, derechos del usuario y un plan compatible; 402/403/404 no equivalen a historial vacío. Solo puede contrastarse contenido que Kommo conserve y exponga. También faltan logs autorizados del webhook y ejecutor, con hora, versión desplegada, correlación y resultado HTTP, sin secretos. No hay conector de logs de producción disponible en esta sesión.

Fuentes oficiales: [historial de conversación](https://developers.kommo.com/reference/get-conversation-messages), [conversaciones](https://developers.kommo.com/reference/get-talks), [permisos y reautorización](https://developers.kommo.com/docs/permissions), [integración privada](https://developers.kommo.com/docs/private-integration), [token de larga duración](https://developers.kommo.com/docs/long-lived-token).

## Ayudas y validación

`src/components/inmobiliaria/marketing/MetricHelp.tsx` sigue devolviendo null. No se sobrescribió el archivo del compañero. Se solicitó confirmar si está editándolo; la coordinación queda pendiente de esa respuesta. Criterios de entrega: ayuda visible al pasar cursor, control accesible por teclado y toque, texto asociado al indicador y explicación de qué cuenta/fechas/significado. La prueba de navegador de métricas continúa pendiente mientras falte el componente; no se declara resuelta con un cambio de etiquetas.

En esta continuación pasaron cinco pruebas aisladas: cuatro del acceso (cuenta, vínculo, historial, 403 y ausencia de conversaciones) y la del diario en PGlite con permisos por defecto reales reproducidos. Son simulaciones, no acceso real a Kommo. La ejecución real del comprobador solo confirmó que faltan credenciales. Los hallazgos de SQL sí proceden de la base conectada, pero no certifican integridad contra el origen.

No se consideran correctos los indicadores ni terminada la sincronización. No se ha medido todavía el retraso completo origen → CRM con mensajes originales contrastados. La recuperación requiere primero esa comparación y un alcance concreto aprobado; no está autorizada por este informe.
