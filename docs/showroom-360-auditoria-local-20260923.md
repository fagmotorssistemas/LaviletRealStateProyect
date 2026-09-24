# Showroom 360: mapa y auditoría local

Fecha: 23/09/2026. Rama main. Inspección estática y dos reproducciones con datos sintéticos. No se modificó el showroom, no se abrieron endpoints productivos ni se enviaron formularios. No certifica el estado del despliegue o de los datos remotos.

## Superficies identificadas

| Superficie | Entrada / archivos principales | Función |
| --- | --- | --- |
| Recorrido público | `src/app/tour/page.tsx`, `TourViewerLoader.tsx` | Visor cargado en cliente, sin SSR |
| Visor y controles | `src/components/tour/TourViewer.tsx`, `tour-viewer.css` | Photo Sphere Viewer, Three.js, giroscopio, escenas, unidad seleccionada, paneles |
| Acceso desde inicio | `src/components/marketing/HomeTourSection.tsx`, `LaviletStory` | Presentación y entrada al recorrido |
| Enlace por unidad | `src/lib/tour/unitDeepLink.ts` | `?unidad=`, selección y URL compartida |
| Ficha pública | `src/app/tour/unidad/[id]/page.tsx`, `src/lib/tour/unitReference.ts` | Detalles y referencia de una unidad concreta |
| Modelo independiente | `public/tour/modelo-3d/segunda-planta.html`, `src/lib/tour/unitModels.ts` | Modelo 3D distinto del visor panorámico; mapa explícito 201–211 |
| Agenda CRM | `src/app/inmobiliaria/showroom/page.tsx` | Visitas comerciales; no es el recorrido 360 |

## Dónde ajustar cada parte

- Navegación entre ambientes: `buildTourNodes.ts`, `roomScene.ts`, `tourRooms.ts`, `TourRoomBar`, `TourHotspotLayer`, `createTourArrow`.
- Resolución y variantes de imágenes: `pickTourWidth.ts`, `roomScene.ts`; scripts de reducción/restauración en `scripts/`. No ejecutar esos scripts como parte de una inspección: algunos modifican archivos o almacenamiento.
- Plano, pisos y selección: `TourFloorPlan.tsx`, `TourFloorLocationPeek`, `floorPlanHotspots.ts`, `floorPlanZones.ts`, `floorPlanClientCache.ts` y las API `floor-plans` / `floor-plan-html`.
- Acabados, iluminación y comparación: `TourComparador`, `TourFinishCompareOverlay`, `CompareSidePano`, `TourTerminacionesPanel`.
- Ficha, precios y financiación: `TourFichaDrawer`, `TourSimulatorDrawer`, `TourFinancingDrawer`, `fichaSpecs.ts`, `fichaTecnicaPdf.ts`.
- Favoritos y solicitud: `TourFavoritesPanel`, `TourSaveUnitModal`, `TourInfoRequestModal`, `TourLeadGate`, `showroomIdentity.ts`.
- Voz: `TourVoiceAssist` y API `voice-assist` / `voice-assist/speak`.

## Datos y efectos existentes

El visor combina dos caminos: `tour.service.ts` consulta `unit_types`, `tour_panoramas`, `finish_packages` y `units`; `/api/tour/catalog` construye otro catálogo con `typology_assets`, tipologías, unidades y acabados. El arranque carga ambas fuentes y usa escenas públicas como alternativa. `tour_transitions` no se reproduce en el camino documentado por el servicio.

La actividad usa `useTourSceneTracking`, `visitorTracking.ts`, `useTourDwellTracking`, las API `session`, `event`, `track`, `lead`, `identify` y `favorites`. `identify` reutiliza el POST de `lead`. Los RPC incluyen `start_tour_session`, `log_tour_event`, `identify_tour_lead_with_meta_outbox` y `register_tour_info_request`.

El formulario de identificación puede crear/vincular un contacto y preparar eventos Meta según tipo de solicitud y consentimiento. Una visita de prueba puede generar sesiones/eventos. No se ejecutaron esos caminos. El aviso automático del gate tiene una desactivación explícita en `useTourSceneTracking.ts`; conservarla salvo ajuste solicitado.

## Hallazgos

1. **Selección por prefijo ambigua, reproducida.** `findUnitByNumber` intenta coincidencia exacta y después `startsWith` en ambos sentidos. Con unidades 101 y 102, buscar `10` devuelve 101. Antes de ajustar enlaces o selector, conviene exigir coincidencia inequívoca y mostrar ausencia/ambigüedad en lugar de elegir el primero.
2. **Resolución solicitada no respetada, reproducida.** `pickCatalogPanoUrl` con ancho 2048 y variantes 2048/8192 devuelve 8192. `pickTourWidth` además prioriza capacidad de GPU; no mide red. Revisar el orden de elección antes de optimizar móvil. Esto no es una medición de carga real ni demuestra un fallo en todos los dispositivos.
3. **GET del catálogo puede escribir.** Si no encuentra acabados activos, `/api/tour/catalog` llama `ensureDefaultFinishPackages`, que inserta valores ausentes. Una consulta visual no es necesariamente de solo lectura. Separar inicialización de datos de lectura pública antes de usar esta ruta en pruebas que deban ser inocuas.
4. **Publicación y alcance del catálogo requieren revisión.** La consulta pública de `units` filtra tenant pero no `is_published`; `typology_assets` se consulta sin filtro de tenant/proyecto. El camino de `tour.service.ts` sí filtra publicación de unidades. Está confirmada la diferencia de código, no una exposición efectiva de registros: falta contrastar esquema y catálogo autorizado.
5. **Plano HTML ejecutable en el mismo origen.** `floor-plan-html` sirve HTML de Storage con scripts y CSP permisiva; el iframe no tiene `sandbox`. Hay integración directa con `contentWindow` y `postMessage('*')`. Revisar quién puede cargar esos archivos y cómo aislar el plano sin romper la comunicación. No se probó explotación ni se afirma que el contenido actual sea malicioso.
6. **Recepción de actividad pendiente de auditoría de permisos.** `/api/tour/event` toma session_id y visitor_id del cuerpo y usa cliente privilegiado; la ruta no comprueba por sí misma su pertenencia a la cookie del visitante. Antes de concluir vulnerabilidad, revisar validaciones efectivas de RPC y esquema remoto. No se enviaron eventos fabricados.
7. **Concentración de lógica.** `TourViewer.tsx` tiene 3690 líneas y coordina catálogo, WebGL, móvil, identidad, selección, financiación y paneles. Los ajustes deben acotarse por componente y comprobar cambio de unidad, apertura/cierre y orientación para evitar efectos cruzados. Se observaron limpiezas de listeners y destrucción del visor; eso no sustituye una prueba de memoria en navegador.

## Validación y siguiente recorrido

- Reproducciones locales puras: selección `10` → 101; petición 2048 → variante 8192. Sin red ni escritura de datos.
- TypeScript y ESLint del panel de Métricas pasaron tras retirar sus mensajes. No son pruebas visuales del showroom.
- Pendiente para los ajustes: probar escritorio/móvil, orientación, zoom, giro, cambio de ambiente/unidad, variantes faltantes, plano 3D, favoritos y panel de financiación; medir carga y memoria con red limitada.
- Los formularios y tracking deben probarse con datos aislados o con autorización expresa para sus efectos. No presentar una navegación con servicios simulados como validación del CRM, de Meta ni de inventario real.
- Mantener selección de unidad, precio, ficha, plano y enlace coherentes; no cambiar identidad, consentimiento, puntuaciones ni envíos Meta al hacer ajustes visuales.

Los documentos `SHOWROOM-PABLO.md` y `SHOWROOM-2-PABLO.md` son contexto histórico, no prueba de capacidades publicadas actuales. Este mapa se basa en el código local existente.
