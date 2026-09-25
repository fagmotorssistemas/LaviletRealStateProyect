# Validación por hechos y selección por precio

La selección relativa «la más cara» o «la más barata» se convierte en ranking de precios antes de elegir una unidad. Se utiliza el conjunto consultado y precios publicados autorizados; sin precios completos no se afirma un extremo. Los empates permanecen explícitos.

Cuando está habilitada la revisión semántica y la respuesta no tiene decisiones operativas protegidas, los números de opciones secundarias de la base dejan de ser obligatorios. No se reinsertan automáticamente esas frases. Las rutas operativas protegidas, visitas y enlaces requeridos conservan sus controles.

La revisión semántica se ejecuta incluso si el redactor repite la base. Evalúa cobertura y evidencia; no debe aprobar una respuesta por copiar una base deficiente. Extrae `factual_values` con fragmento, ID de unidad, atributo y valor. El código comprueba esas relaciones contra el catálogo. Los controles numéricos de la revisión de cobertura se aplican después de la revisión semántica; un aprobado del modelo no los anula. Formato, enlaces y otras restricciones de acciones siguen pudiendo detener una propuesta antes de llamar al revisor.

Se reutiliza la llamada de revisión existente. En turnos que antes omitían la revisión por repetir la base habrá una llamada adicional. El esquema de revisión y las instrucciones son mayores. No se garantiza que el modelo extraiga todas las afirmaciones correctamente; permanece una capa probabilística y deben hacerse pruebas reales.

Pruebas: omitir opciones irrelevantes conservando el dato de la unidad solicitada; rechazar relaciones unidad-superficie incorrectas aunque la revisión las apruebe; rechazar evidencia no respaldada o cobertura incompleta; seleccionar el precio máximo; conservar empates; no seleccionar un máximo si faltan precios.

Este cambio no elimina todos los controles lingüísticos del sistema ni convierte cualquier respuesta de la IA en válida. Si una propuesta falla se conserva el respaldo existente; mejorar ese respaldo en otras rutas puede requerir correcciones adicionales. No se han realizado envíos reales a leads para validar estas modificaciones.
