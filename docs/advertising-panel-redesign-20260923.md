# Métricas embudo: reorganización local

La presentación activa ahora contiene seis tarjetas, filtros de fechas/campaña/anuncio/nombre y una tabla de campañas expandibles. La identificación de propiedades se conserva dentro del detalle de anuncio. Las campañas externas y los anuncios con gasto sin contactos permanecen visibles.

## Cálculos y evidencia

- Una agregación compartida alimenta tarjetas, filas, totales y listas de personas. Los totales incluyen todos los resultados filtrados, independientemente de la página.
- El gasto se suma una vez por anuncio; el costo total divide ese gasto entre adquisiciones únicas. No se promedian los costos de las filas ni se distribuye gasto entre propiedades.
- Se reutilizan la atribución y las evaluaciones preparadas. Una atribución contradictoria sin origen verificable se señala y no se decide por el orden de las filas.
- Sin evaluar, sin responder comprobado y por verificar permanecen separados. Una respuesta comprobada puede coexistir con una nueva consulta pendiente, visible en el detalle.
- Los contactos sin anuncio quedan fuera del panel; los anuncios sin campaña aparecen bajo Campaña pendiente de identificar.
- Las ayudas usan AccessibleMetricHelp. No se sobrescribió el archivo MetricHelp del compañero, que devuelve null.
- El refresco de consulta cada 60 segundos y al volver a la pestaña se distingue de la sincronización. Se presentan los tiempos registrados de las fuentes y la hora de consulta; refrescar no certifica sincronización.

## Validación de esta reorganización

- Compilación de producción, TypeScript, ESLint de los componentes/lógica modificados y comprobación de diferencias: correctos.
- Cuatro pruebas de agregación: filtros, atribución, gasto sin contactos, externos, campaña pendiente, totales y datos incompletos.
- Navegador con datos simulados en escritorio y móvil: seis tarjetas, expansión, paginación, filtros dependientes, personas exactas, subfiltros de atención, ayudas por teclado/toque/cursor, fechas y refresco simulado. El total permanece independiente de la página. Sin desbordamiento horizontal del documento; la tabla tiene desplazamiento propio.
- Estas pruebas no validan mensajes reales ni el funcionamiento de la sincronización en producción. La comprobación de acceso a Kommo devuelve KOMMO_CREDENTIALS_MISSING. No se contrastó el historial completo ni se realizó una nueva consulta autenticada a Meta en esta reorganización.

## Estado de entrega

Todo permanece local en main. No se ejecutaron migraciones remotas, recuperación de históricos, commit, push ni despliegue. Se conservaron las correcciones previas de sincronización, protección y evaluación de interés; sus migraciones pendientes no se activan con este cambio de presentación. No se modificaron envíos CAPI para construir esta pantalla.
