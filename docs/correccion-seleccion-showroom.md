# Selección de unidad y entrega del showroom — 22/09/2026

Evidencia: ejecución de las 15:23, mensaje «revisemos la opcion 502 entocnes». La interpretación registró `primary_intent=select_property`, unidad explícita 502 y `operation=search`. La resolución mantuvo search; `catalog_search` preparó una pregunta para ofrecer detalles, sin enlace. El redactor no recibió un enlace obligatorio en esa base.

Corrección acotada:

- Una elección literal e inequívoca que responde a `choose_unit` resuelve la unidad entre los candidatos disponibles antes de aplicar los filtros de búsqueda. Se registra `explicit_pending_choice` y se ejecuta `select`.
- «Sí envíeme los detalles» acepta `show_unit_details` con su referente pendiente. La regla del brochure no consume esa frase cuando el último mensaje del bot ofrece detalles de una unidad concreta. Una petición explícita de brochure sigue siendo válida.
- La validación del catálogo rechaza `unit_tour_omitted` si la respuesta pierde el enlace de `audit.unit_model.url`.

El showroom no requiere que el modelo esté terminado para construir el enlace. No se modificó su página ni se verificó contenido publicado en producción.

Pruebas: reproducción de la interpretación inconsistente, aceptación de detalles, solicitud explícita de brochure, menciones que no constituyen elección y rechazo de una reformulación que omite el enlace, hasta el registro simulado de salida a Kommo. Los servicios externos se simulan; no se envían mensajes reales.

Pendiente y fuera de este cambio: resolver por separado detalles de una unidad y máximo residencial en un mismo turno; investigar la afirmación de que el 502 es la mayor vivienda; mejorar búsqueda y presentación de la bitácora.
