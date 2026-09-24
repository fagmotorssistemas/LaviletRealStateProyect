# Showroom La Vilet: entrega local

## Abrir y revisar

En `D:\FrontLaVilet`, ejecutar `npm run dev` y abrir la dirección local que indique Next, ruta `/tour`. Un enlace como `/tour?unidad=202` conserva la unidad. El menú está arriba a la izquierda. No se publicó ni se cambiaron datos remotos. Se mantuvo main y el trabajo existente.

## Implementación

- Menú lateral con cierre, Escape y foco contenido; Inicio, Áreas, búsqueda residencial, locales, recorrido, amenidades, obra y contacto. Áreas abre el plano/pisos; Amenidades lee las instalaciones del proyecto. No copia contenido de la referencia de PROACO.
- Pantalla completa con entrada/salida y aviso si el navegador la rechaza. Se quitó la rotación forzada por CSS de toda la aplicación en teléfonos verticales; se conserva el visor y sus controles normales de orientación.
- Búsqueda por número, piso, dormitorios, tipo, disponibilidad y superficie mínima/máxima. Las unidades comerciales se separan de las viviendas y no muestran dormitorios como característica.
- Ficha y visor existentes reutilizados. La tipología se obtiene de la unidad seleccionada: un local sin tipología no hereda fotos del departamento anterior. Los recursos compartidos se identifican como referencia; una imagen compartida no demuestra una vista exterior específica.
- QR generado localmente, sin servicio externo de QR. Apunta al dominio público de La Vilet, `/tour?unidad=...`, nunca a ventas. El QR de la ficha y del menú preservan el número. Su destino productivo todavía usa la versión publicada anterior; los cambios de esta entrega solo son locales.
- Acceso al showroom desde ficha de inventario y listado de cierres de ventas para unidades de La Vilet, bajo los permisos actuales de esos módulos. El recorrido público solo consulta unidades publicadas; no se agregaron permisos para unidades privadas.
- Se conserva el panel de terminaciones por ambiente y comparación. El modelo 3D explícito 201–211 sigue siendo un recurso independiente; no se extiende artificialmente a pisos diferentes.
- Correcciones de base: selección de unidad por coincidencia exacta, resolución 2048 preferida frente a 8192 cuando está solicitada y disponible, superficie total tomada del dato registrado. El GET del catálogo deja de crear acabados.
- Inglés y español para el menú y sus nuevas pantallas, manteniendo selección y sección en memoria. No se encontró una infraestructura de idiomas previa para integrar. Visor antiguo, textos de inventario, instalaciones y voz siguen en español; el selector lo informa. No se anuncia traducción completa.

## Voz

Se mantiene la integración existente: OpenAI primero, Edge y navegador como respaldo. No se cambió proveedor, modelo configurado ni credenciales.

Se añadió cancelación de peticiones del turno anterior y de fragmentos de voz precargados. Interrumpir, silenciar, cerrar el panel o cerrarlo desde el menú descarta respuestas atrasadas. Los audios pausados liberan sus promesas; cerrar descarta la grabación incompleta. Se eliminó una repetición tardía posible por `voiceschanged`.

Durante una conversación activa, un monitor del micrófono con cancelación de eco intenta detectar una intervención y pasa a escucharla. La detección usa un umbral de señal sostenida de 120 ms. No es instantaneidad acústica garantizada: falta calibrar con micrófono/altavoz reales, especialmente eco, ruido y pérdida de la primera sílaba. Siguen disponibles «Interrumpir y hablar», «Silenciar» y cierre. No declarar validada esta parte en un teléfono por haber compilado.

Comparaciones explícitas, por ejemplo «compara 201 y 202» o «compara las dos», usan filas publicadas consultadas desde el servidor; no se confía en precios enviados por el navegador. Incluyen superficie, dormitorios, piso, precio y estado. Si faltan planos o vistas originales no se afirman diferencias en distribución ni ventajas de vista. La consulta actual admite hasta 250 unidades; el alcance real consultado tiene 65. Para un proyecto que exceda ese límite, ampliar paginación antes de presentarlo como catálogo completo.

## Evidencia y límites

- Consulta real MCP de solo lectura: 65 unidades publicadas, 49 residenciales y 16 locales; ninguna fila en unit_media para esas unidades. Hay recursos por tipología y 16 instalaciones registradas. Los locales LC-01–LC-16 carecen de tipología y medios vinculados.
- [Detalle por unidad](./showroom-recursos-por-unidad-20260923.md). Es auditoría de registros: no certifica geometría, puertas/ventanas, calidad de cada imagen ni acceso a todos los archivos.
- Prueba de navegador aislada con inventario simulado: anchos 1440, 768 y 390; menú, filtros, ficha/recorrido mediante callbacks, idioma, QR, amenidades simuladas, obra vacía y Escape. Capturas `showroom-menu-1440.png`, `showroom-menu-768.png`, `showroom-menu-390.png`. No prueba el WebGL completo ni acceso real al CRM.
- Pruebas puras: filtros, separación de locales, enlaces exactos, tamaños de imágenes, comparaciones y cancelación de audio atrasado con red/audio simulados.
- Compilación Next completa superada durante la implementación. TypeScript y comprobaciones posteriores cubren los cambios finales. Sin prueba acústica real, sin escaneo físico del QR y sin validación de planos en un dispositivo real.

## Recursos necesarios y propuesta de administración

**Por unidad:** planos aprobados con correspondencia exacta, modelo 3D cuando exista, panorama 360 y vistas exteriores identificadas por unidad, orientación y piso. Para LC-01–LC-16: también tipología/recursos propios. No usar el modelo 201–211 para otras plantas ni una foto exterior como vista de todas las viviendas.

**Obra:** no se encontró un registro fechado existente. Se preparó `src/lib/tour/constructionProgress.ts`, vacío, con campos de fecha, título, descripción y medios. La pantalla puede presentar fotos/video de esa estructura cuando el responsable suministre contenido aprobado. No se añadieron imágenes ilustrativas ni porcentajes.

Propuesta para administración futura desde CRM: entidad `construction_updates` con proyecto, fecha real, título/descripción por idioma, estado borrador/publicado, autor y revisor; entidad de medios con archivo, tipo y pie de foto. Subida privada, validación y publicación explícita por administrador del proyecto; visitantes solo leen publicaciones. Conservar revisiones, no sobrescribir fechas de captura. Preparar y revisar migración/RLS y almacenamiento antes de activar; esta entrega no los crea ni exige contratar un proveedor nuevo.

**Idiomas:** traducciones aprobadas de fichas, nombres de ambientes/materiales, instalaciones y actualizaciones; después extender el contexto de idioma al visor y voz. No cambiar solo la voz para leer datos que permanecen en otro idioma.

## Prueba humana pendiente

1. Abrir una unidad y comprobarla contra su plano aprobado; cambiar de piso y unidad, revisar que ficha, precio y recursos corresponden.
2. Desde móvil, abrir/cerrar menú, girar dispositivo, navegar panoramas y abrir plano 3D; probar pantalla completa cuando esté disponible.
3. Escanear QR desde otro teléfono y confirmar la misma unidad en la versión pública.
4. Activar voz con permiso de micrófono; pedir dos unidades, interrumpir a mitad de audio con otra pregunta, luego silenciar y cerrar. No deben reaparecer fragmentos antiguos. Repetir con auriculares y altavoz; medir latencia y posibles falsas interrupciones.
5. Esta prueba de voz usa los servicios configurados y puede generar consumo. Las pruebas ejecutadas por el agente fueron simuladas; no se contrataron servicios ni se hicieron llamadas reales de voz.

Referencias técnicas consultadas: [QR local](https://github.com/soldair/node-qrcode), [análisis de audio](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getFloatTimeDomainData), [consultas Supabase](https://supabase.com/docs/reference/javascript/select).
