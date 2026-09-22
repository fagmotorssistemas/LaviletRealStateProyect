# Preferencia de dormitorios y alternativas — 22/09/2026

Evidencia revisada en la bitácora de Carlos Fabián, 16:19–16:20: «Me interesa una vivienda, tiene opciones de 5 habitaciones?» produjo bedrooms_required=true. La regla de no insistir con alternativas menores preparó solo la negativa. El redactor añadió categorías genéricas. El siguiente turno mantuvo el requisito; «Bueno que opciones tiene?» volvió a consultar cinco dormitorios obligatorios.

Cambios:

- La interpretación debe tener evidencia literal explícita de exigencia para elevar bedrooms_required a true. Una pregunta de disponibilidad o «me serviría» no bastan. Las interpretaciones descartadas dejan la incidencia bedrooms_requirement_without_explicit_evidence.
- Se corrigió el reemplazo ortográfico que podía modificar «habitaciones» bien escrito, manteniendo compatibilidad con «de5habiataciones».
- Una petición directa de otras opciones, tras una cantidad de dormitorios sin coincidencias, abre una consulta alternativa. Conserva original_query y sus requisitos; no registra que el cliente haya renunciado a ellos. Mantiene categoría, exclusiones y los otros filtros previos.
- La resolución deja el motivo requested_alternatives_after_no_match. Sin petición de alternativas, un requisito explícitamente indispensable sigue sin relajarse automáticamente.

Pruebas: secuencia real con un extractor simulado que insiste erróneamente en marcar el requisito, más secuencia con exigencia explícita y posterior solicitud de alternativas. Se comprueban superficies, penthouses, memoria original y registro simulado de la respuesta. No se enviaron mensajes reales ni se modificó producción.

La propuesta de monitoreo futuro se conserva en monitoreo-automatizacion-pendiente.md; no está activada.
