# Sincronización, fiabilidad y nivel de interés: cierre local

Trabajo en main, sin commit/push/despliegue, sin aplicar migraciones ni recuperar históricos. Se conserva la protección de reinicios y la recepción transaccional de la corrida anterior. **La protección no está activa en producción.** No se repitieron sus verificaciones aisladas ya concluidas; los cambios de esta corrida no alteran sus funciones.

## Datos reales y acceso

`node scripts/kommo-access-check.cjs` vuelve a responder `KOMMO_CREDENTIALS_MISSING`. No hubo acceso original a conversaciones, asesores, Salesbot o multimedia de Kommo. Las herramientas de comparación paginada quedan listas, pero no ejecutadas contra ese origen. Faltan también logs autorizados de recepción/ejecutor y versión desplegada para completar la cadena hasta pantalla y medir su retraso real.

Consulta nueva al CRM: 36 fichas; 31 sin eventos de puntuación ni fecha de cálculo; cinco con ambos. Los nueve eventos de esas cinco fichas tienen source_message_id que corresponde a un mensaje cliente de sus conversaciones CRM. No certifica todavía identidad y contenido contra Kommo, especialmente los 25 mensajes históricos con IDs diferentes. No se reasignó ninguno ni se fusionaron personas.

Reglas reales: frío por debajo de 25, tibio desde 25 y caliente desde 60, configurados en project_automation_config. Nueve eventos existentes: cinco first_response, dos declared_unit_type, uno asked_price y uno requested_visit. No se cambiaron umbrales ni puntos. Para contactos creados del 24 agosto al 23 septiembre, zona Ecuador: 23 fichas, 18 sin evaluar, tres frías, dos tibias y ninguna caliente con fecha de cálculo. Son conjuntos CRM anteriores a aplicar la exclusión interna pendiente, no una conciliación con Kommo.

## Problemas comprobados y correcciones locales

El valor frio por defecto se mostraba como clasificación aunque nunca se hubiese calculado. Las métricas ahora requieren fecha de evaluación; no deducen evaluación de cero puntos ni de una etiqueta fría. Los cuatro grupos son disjuntos y suman los contactos únicos del anuncio. La atribución conserva el primer origen guardado y no cambia gasto, contactos sin anuncio, campañas externas o publicidad sin contactos.

Cada anuncio muestra su nivel de interés actual y abre exactamente los IDs de cada categoría. El detalle muestra nombre, clasificación, motivo disponible, fecha y enlace a la ficha comercial Kommo, cuando existe. Se aclara que es interés actual de personas adquiridas en las fechas elegidas. Las respuestas y pendientes siguen separados y con cobertura incompleta; no se usa la falta de historial para afirmar abandono o frío.

La llamada actual a apply_lead_events ocurría solo cuando el intérprete reconocía algún evento. No quedaba constancia de una interpretación completada sin nuevas señales. El borrador `20260923211512_interest_evaluation_evidence.sql` añade lead_interest_evaluations y lv_evaluate_message_interest. Guarda mensaje original, fecha de origen, fecha de evaluación, eventos reconocidos, reglas/umbrales usados y resultado. Comprueba negocio/proyecto y mensaje cliente guardado con contenido, bloquea bots y fuentes vacías y deduplica por ficha+mensaje. El procesador la llama solo cuando la interpretación existente es válida, no está fuera de alcance y no falló la lectura multimedia. No se interpreta un audio fallido a partir de su marcador.

Con eventos reconocidos delega en las reglas actuales; con lista vacía registra la evaluación sin nuevos puntos ni cambios de etapa/consentimiento. No se ha ejecutado sobre históricos. No amplía la interpretación a mensajes que el flujo actual no interpreta: estos permanecen sin evaluar. Una evaluación registrada no significa que toda la conversación esté sincronizada.

Dos enfriamientos: el trabajador llama apply_temperature_decay (reglas de 7/14 días, claves por fecha de interacción). lv3_store_cooling es un segundo escritor con otras claves; no se encontraron llamadas actuales en src ni desde otras funciones revisadas, y lv_decay_applied tiene cero filas. Tampoco hay eventos decay en el libro de puntos ni cron directo de enfriamiento. La configuración real está en test_only=true, que impide el enfriamiento global de este trabajador. Antes podía guardar resultado daily_decay incluso al omitirlo: ahora distingue daily_decay_skipped. El borrador retira lv3_store_cooling con error explícito para impedir una segunda vía de descuento; no recalcula puntos antiguos. La función canónica mantiene sus reglas y efectos existentes, incluida la nutrición; no debe usarse para recuperación histórica sin efectos comerciales.

MetricHelp del compañero continúa intacto. Las pantallas importan ahora AccessibleMetricHelp, separado y con interacción por cursor, toque, teclado y cierre accesible. Esta separación resuelve el uso activo sin sobrescribir el archivo pendiente del compañero; una futura unificación debe conservar el contrato de accesibilidad y sus pruebas.

## Recuperación preparada, no ejecutada

El auditor genera vista previa con insertar evidencia, conservar mensajes coincidentes y conflictos por identidad, autor o fecha. Los candidatos de evaluación histórica quedan pendientes de interpretación verificada, con puntos null; el contenido multimedia sin texto interpretable se bloquea. No llama RPC de mensajes, puntuación, bots, etapas, consentimiento ni Meta. Los archivos de revisión permanecen fuera del repositorio. Sin credenciales no existe todavía un inventario original completo que se pueda aprobar para recuperación.

`operations/preview_interest_evaluation_readonly.sql` permite revisar el libro CRM sin escribir. Primero verificar relaciones Kommo y preservar IDs históricos; después revisar la interpretación por fuente, reglas y deduplicación; presentar diferencias antes/después para aprobación. No ejecutar apply_lead_events como importador histórico: modifica etapas. La recuperación final debe limitarse al diario y una aplicación específica sin efectos comerciales, aún pendiente de concretar con los mensajes originales accesibles.

Pablo 4453096/contacto 9431328 mantiene coherencia local previamente comprobada, pero falta la comprobación original; no se aplicó la clasificación interna. No se identifica al compañero por conjetura. Casa De Tarqui y gasto Meta se conservan. No se modificaron Pixel/CAPI, consentimiento o Nest.

## Activación conjunta y recuperación ante fallos

1. Revisar el conjunto de migraciones pendientes y conservar los 116 respaldos; no hacer push masivo de todas las migraciones locales.
2. Aplicar primero protección de reinicios y verificar funciones bloqueadas, permisos y respaldos con el SQL de solo lectura ya preparado.
3. Aplicar evidencia/recepción atómica; verificar sus dos tablas y tres funciones. Aplicar después evaluación trazable y retiro del segundo enfriamiento. Esta última crea una tabla con RLS sin políticas cliente, SELECT únicamente para service_role y función de evaluación SECURITY DEFINER ejecutable únicamente por service_role. El autor del cálculo se valida contra el mensaje cliente y su ficha autorizada.
4. Configurar las credenciales privadamente; comprobar cuenta, alcance de historial y visibilidad completa, ejecutar auditoría paginada. Revisar los errores por conversación, no convertirlos en cero.
5. Solo con autorización posterior desplegar receptor y trabajador juntos, después de existir ambas nuevas RPC. Desplegar también la presentación corregida. Ante función/permiso ausente, detener activación, conservar esquemas y respaldos y revertir únicamente a la versión anterior de aplicación; no revertir la protección ni borrar evidencias.
6. Verificar entrantes/salientes reales, autores, multimedia, IDs, fechas y demoras. Comprobar reintento real de proveedor y recepción transaccional en un canal aislado autorizado. Las pruebas de deduplicación locales no prueban reintentos de Kommo ni garantizan un único efecto en toda integración externa.
7. No ejecutar recuperación por esta aprobación de despliegue: requiere otra revisión del plan exacto. Mantener incompletos los indicadores mientras falte cobertura original. Hora de consulta, fecha de cálculo y última sincronización son conceptos diferentes.

Los reintentos de Kommo son limitados y no sustituyen un almacenamiento duradero independiente durante una caída prolongada. No se ha preparado un segundo almacén; no se promete cero pérdida ante agotamiento de reintentos. El cierre de fiabilidad depende de original accesible, logs y verificación real posterior.

## Validación local

La batería de integración ejercitó 221 casos: 220 pasaron inicialmente y se ajustó el caso restante para distinguir registro de una evaluación vacía de otorgar puntos; ese caso pasó después. Pasaron las pruebas de clasificación (cero puntos no implica evaluación, grupos disjuntos), atención incompleta, comparación histórica y la nueva migración en PGlite con reglas reales extraídas del SQL existente. Esta última verifica autor cliente, rechazo de audio vacío/bot, evaluación sin señales, deduplicación, permisos y bloqueo del segundo enfriamiento. TypeScript, ESLint de cambios y compilación pasaron. La última adición del resumen publicitario se validó con TypeScript y navegador.

En navegador se corrigieron los datos incompletos del escenario simulado y su imitación de router.refresh, que no debe borrar el estado local de Next. No se alteraron datos reales para hacer pasar pruebas. Se comprueban ayudas por cursor/teclado/toque, conjuntos exactos al pulsar, campañas externas, anuncios sin contactos y persistencia simulada de identificación. El archivo del compañero MetricHelp.tsx conserva literalmente su contenido; el componente activo es AccessibleMetricHelp.

Nada de lo anterior sustituye el contraste con Kommo ni demuestra funcionamiento desplegado. Los controles de acceso original, historial, reintentos y demoras reales continúan pendientes.
