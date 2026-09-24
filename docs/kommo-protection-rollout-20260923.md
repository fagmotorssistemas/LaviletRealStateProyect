# Protección y activación pendiente — 23 septiembre 2026

Todo preparado localmente en main. No se ejecutó DDL/DML remoto, recuperación, reasignación, clasificación, commit, push ni despliegue. Los indicadores conservan `coverage.kommo=false`.

## Aumento de 676 a 684: fechas distintas

Consulta real a las 21:03:25 UTC / 16:03:25 Ecuador: 684 eventos cancelados sin mensaje activo, 116 respaldos; último respaldo 20:41:25 UTC. El esquema de evidencia y la protección todavía no están aplicados. Huella agregada de IDs y contenidos de los respaldos: `11903d4f433afecc120a4deaaa8fef23` (MD5 usado como comprobación de cambios, no como firma de seguridad).

Se recorrieron todas las versiones y se tomó el primer respaldo en que cada evento todavía no estaba cancelado. Ocho eventos adicionales tenían estado completed y mensaje original dentro del respaldo. Después figuran cancelados y sin mensaje activo. Son nuevas eliminaciones posteriores al primer corte, no ocho registros antiguos recién descubiertos.

| Grupo | Fecha del mensaje en Kommo, recibida en payload (UTC) | Recepción CRM (UTC) | Respaldo de la operación de borrado (UTC) | Ecuador |
|---|---|---|---|---|
| 5 mensajes | 23 septiembre 16:29:54–16:36:24 | 16:29:57–16:36:26 | 20:16:04.420477 | Mensajes 11:29–11:36; reinicio 15:16 |
| 3 mensajes | 23 septiembre 20:16:15–20:19:15 | 20:16:18–20:19:17 | 20:41:25.120176 | Mensajes 15:16–15:19; reinicio 15:41 |

Primer grupo: df30deb5-78e0-456f-aba3-d2177b1d427b, 039936b0-1ef8-4c33-8b76-d3683e0740f1, 18830178-8efa-42c9-ab04-395be5022db7, e1280417-878e-4660-b7be-90fcf543c87b, 0987627c-a84b-4a5e-91f1-d1a9bf8aa704. Respaldo 58e9c63c-06c3-4c8a-854c-07d0dc540504.

Segundo grupo: 3ddb8be6-948d-40bf-b9af-b60870377ae9, 4f9a8431-642d-495b-801a-590e1d1d7d95, e64bf69a-843e-4b0d-bfcc-b489881a7987. Respaldo d1002695-f777-4277-a29d-80e7a3f15bd9.

captured_at marca el respaldo previo dentro de la transacción del reinicio, no el instante exacto de cada DELETE. No hay auditoría por fila que permita dar esos microsegundos. Las fechas del payload aún necesitan contraste con Kommo.

## Entradas que permiten reiniciar

- `lv_reset_lavilet_test_contact(integer)` ejecuta el borrado; `lv_reset_lavilet_test_lead()`, `lv_reset_lavilet_nataly_lead()` y `lv_reset_lavilet_pablo_lead()` lo delegan. Son llamadas SQL privilegiadas, no acciones de cliente actualmente autorizadas.
- `supabase/operations/reset_test_lead.sql` llamaba directamente al reinicio; `reset_nataly_test_lead.sql` instalaba funciones y además ejecutaba el reinicio. `operations/activar_reinicio_pablo_y_nataly.sql` reinstalaba funciones; `corregir_reinicio_financiamiento.sql` modificaba su cuerpo. Estos cuatro archivos quedan retirados: devuelven error y todo el SQL histórico queda comentado para consulta, sin instrucciones ejecutables de borrado.
- Las migraciones históricas conservan su contenido. No se deben reaplicar después de la protección. Las pruebas cargan esas definiciones exclusivamente en PGlite aislado.
- `scripts/resume-test-lead.cjs --apply` reactivaba la automatización de contactos concretos después del reinicio. No borraba mensajes, pero ahora se bloquea antes de cargar entorno o hacer peticiones.
- `lv_test_reset(text)` es otro reinicio legado de prueba; no explica el borrado de mensajes investigado, pero también queda retirado de producción.
- Búsqueda de llamadas en src: no hay botón/ruta/acción de reinicio destructivo; los controles de limpiar filtros no borran historial. Consulta real: cero trabajos cron con reset y cero disparadores que llamen las funciones de reinicio. No identifica ejecutores externos o SQL Editor: faltan logs con sesión/operador. El motivo `lead_reset_by_user` de los cinco eventos antiguos sigue sin origen identificado.

## Protección preparada

`20260923205830_disable_destructive_contact_resets.sql` reemplaza los cuerpos de las cinco entradas por error 42501 `DESTRUCTIVE_TEST_RESET_DISABLED`, conserva sus firmas y revoca EXECUTE a PUBLIC/anon/authenticated/service_role. Incluso el propietario recibe error al invocar una entrada. No hay interruptor de entorno ni excepción por teléfono/ID que permita volver a borrar datos reales.

Añade `lv_preserve_reset_backups()` y dos disparadores BEFORE UPDATE/DELETE/TRUNCATE para mantener intactos los respaldos existentes, además de revocar esos permisos a los roles de aplicación. No toca las filas, no borra tablas y no modifica procesamiento comercial normal. INSERT de nuevos respaldos no queda bloqueado por el disparador. Un administrador que deliberadamente reemplace funciones o desactive disparadores puede eludirlos; esta migración no elimina sus facultades DDL.

En el navegador, `fetchWithTimeout` rechaza estas llamadas RPC antes de usar la red. El cliente administrativo del servidor utiliza el mismo control y `automation/data.ts` añade el bloqueo por nombre. La base bloquea también llamadas HTTP directas que eviten el cliente. No se añadió un botón de reinicio donde no existía.

Pruebas separadas: `node --test scripts/manual-test-lead-reset.test.cjs` crea y destruye una base PGlite en memoria con fixtures. No carga .env ni conecta Supabase/Kommo. Se actualizó su dependencia a la instalación local de PGlite; no hace falta una carpeta temporal externa. Esto conserva la prueba del mecanismo histórico sin ofrecerlo sobre fichas reales.

Los 25 mensajes permanecen en sus conversaciones y con identificadores históricos. No se recuperan, reasignan o fusionan por teléfono. Los respaldos permanecen en producción sin modificación.

## Persistencia y reintentos

El borrador de evidencia añade ahora una tercera función: `lv_receive_kommo_observation(jsonb,jsonb,jsonb)`, SECURITY INVOKER y EXECUTE solo service_role. Llama al diario y a ambos receptores actuales en una única transacción. Si falla cualquier escritura, todo revierte. Con automatización apagada recibe listas comerciales vacías y solo guarda evidencia. No ejecuta directamente el trabajador ni envía respuestas.

Se comprobó el código SQL real de ambos receptores: deduplican con `(project_id,event_key)`; los prefijos son inbound/advisor_outbound más ID original. El diario tiene su propia clave única. La prueba aislada carga esas definiciones reales y demuestra: fallo de evidencia no encola; fallo posterior del receptor revierte evidencia y eventos; repetir tras una confirmación cuya respuesta se perdió añade cero filas y cero eventos. Esto verifica la persistencia, no garantiza por sí solo exactamente un envío de cualquier integración aguas abajo.

La ruta devuelve 200 únicamente después de confirmar la transacción. Un fallo devuelve 503 y registra correlación y cantidades sin contenido ni secretos. No hay reenvío de mensajes a clientes como mecanismo de recuperación. No se hacen reintentos lentos dentro de la ruta: Kommo espera respuesta en 2 segundos y deben medirse las latencias reales antes de activar.

Kommo documenta reintentos del webhook a los 5 minutos, luego 15, 15 y 60 minutos según los códigos de respuesta; también puede desactivarlo tras errores reiterados. Esto es comportamiento documentado, **no prueba de la suscripción de esta cuenta**. Si la base falla hasta agotar los intentos y no existe copia accesible en Kommo, este receptor no garantiza cero pérdida: no se ha implementado un segundo almacenamiento duradero independiente. Es un bloqueo explícito para declarar la sincronización fiable. Hará falta verificar reintentos, disponibilidad del historial y una estrategia de conciliación aprobada; no se recupera automáticamente durante esta auditoría. [Fuente oficial](https://developers.kommo.com/docs/webhooks-general).

## Orden de aplicación, todavía no autorizado

1. **Protección primero:** revisar y aplicar de forma explícita la migración de bloqueo de reinicios. Registrar conteo/huella de los 116 respaldos antes y después. No hacer un push masivo de migraciones locales ni reinstalar operaciones retiradas.
2. **Esquema de evidencia:** aplicar el borrador `20260923174920_kommo_message_evidence.sql`, revisado con dos tablas y tres funciones. No ejecutar clasificación ni histórico. Aunque el nombre de archivo es anterior, el bloqueo puede priorizarse como cambio explícito separado; registrar correctamente ambos en el historial de migraciones.
3. **Comprobar permisos y funciones:** ejecutar solo SELECT de `operations/verify_kommo_protection_readonly.sql`. Esperar cinco reinicios bloqueados y sin EXECUTE de aplicación, dos disparadores activos, ambas tablas con RLS y privilegios mínimos, tres funciones de evidencia/clasificación solo ejecutables por service_role. Comprobar en particular que no sobreviven los permisos predeterminados amplios. Verificar acceso real del receptor; no probar borrados contra producción.
4. **Acceso Kommo y contraste:** configurar privadamente .env.local; ejecutar `node scripts/kommo-access-check.cjs` y, si permite consultar historial, `node scripts/kommo-crm-audit.cjs`. No avanzar sobre 402/403/404 como si fueran conversaciones vacías. Confirmar visibilidad de toda la cuenta, todos los canales del alcance, paginación y relaciones históricas. La auditoría solo prepara archivos de revisión.
5. **Despliegue del receptor, con autorización posterior:** únicamente tras existencia/ACL de la función atómica y controles anteriores. Mantener incompletos los indicadores. Supervisar fallos, desactivación del webhook, último ingreso exitoso y latencia; hora de consulta no es última sincronización.
6. **Verificación real posterior:** seguir IDs originales entrantes/salientes, bot/asesor y multimedia desde Kommo a recepción, diario, eventos, mensajes y pantalla. Medir retraso origen→recepción→persistencia y respuesta HTTP. En un canal de prueba aislado autorizado, inducir un fallo y comprobar los intentos efectivos y la ausencia de duplicación; no inducir fallos sobre clientes reales. La recuperación histórica necesita alcance revisado y aprobación independiente.

No hay despliegue autorizado ahora. Los bloqueos locales no protegen todavía la base de producción.

## Validación de esta continuación

Datos reales: inventario de funciones, búsqueda de cron/disparadores, ocho eventos con sus fechas y respaldos, conteo/huella, ausencia de ambas migraciones aplicadas. Acceso real a Kommo: el comprobador devuelve `KOMMO_CREDENTIALS_MISSING`; no se ejecutó auditoría original ni se presupuso permiso de historial.

Pruebas aisladas: bloqueo de navegador/servidor/propietario, inmutabilidad de respaldos, fixtures separados, recepción sin activar bot, atomicidad y deduplicación usando SQL de los receptores, permisos mínimos y errores del acceso. TypeScript pasó. Estas pruebas no validan conversaciones reales ni garantizan reintentos del proveedor.

También pasaron ESLint de los archivos TypeScript modificados, `git diff --check` y la compilación completa `npm run build`. Se mantienen las protecciones existentes del trabajador: las operaciones interrumpidas pasan a uncertain y no se reenvían automáticamente; esto se revisó en código, no mediante envíos reales.

El auditor preparado acepta tanto id como talk_id del listado original, informa errores por conversación y cantidades por canal, y no certifica cobertura completa por el mero éxito de las peticiones: falta comprobar visibilidad de la cuenta.

No se modificaron MetricHelp ni los textos/ayudas del compañero. La cobertura original continúa incompleta.
