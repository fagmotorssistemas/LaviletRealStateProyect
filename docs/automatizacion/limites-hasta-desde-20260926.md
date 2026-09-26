# Corrección de límites «hasta» y «desde»

La ejecución del 26 de septiembre a las 11:09 rechazó dos máximos correctos: «hasta 120,83 m²» para departamentos y «hasta 142,09 m²» para penthouses. El revisor los representó con `lte`, pero `relationBefore` omitía «hasta» y devolvía igualdad. La reparación repetía una interpretación correcta y volvía a fallar.

Cambios:

- `numeric-relations.ts`: interpretación compartida de «hasta», «desde», «a partir de», «máximo de» y «mínimo de», con normalización de acentos y mayúsculas. Distingue un extremo anunciado del catálogo de un límite matemático general.
- `semantic-review.ts`: un máximo o mínimo de grupo debe coincidir con el extremo verificado; «hasta 150» no pasa porque el máximo real de 142,09 sea simplemente menor que 150.
- `catalog-dialogue.ts`: cada superficie conserva el grupo al que pertenece, usando referencias del revisor previamente verificadas. Se separan cláusulas comparativas para no validar departamentos y penthouses como un único grupo. La comprobación posterior utiliza los mismos operadores.
- `messageExplanation.ts`: descripción legible del rechazo por máximo o mínimo incorrecto.

El replay del texto completo también detectó que el revisor etiquetó «La Vilet no cuenta con departamentos de 5 o 6 dormitorios» como afirmación aunque citó correctamente la consulta vacía. Se admite esa etiqueta para la negación literal «no cuenta/no cuentan con» únicamente con revisión aprobada, consulta completa sin coincidencias y los filtros coincidentes ya exigidos. No se omite la comprobación ante revisión rechazada o evidencia incompleta. Se amplió la prueba al borrador completo, no solo a las frases de superficies.

Pruebas: reproducción del fallo con ambas categorías en una misma frase, aceptación sin reparación, comprobación final del catálogo, variantes de límites inclusivos e intervalos, y rechazo de extremos inventados. Los casos son datos de prueba; no restringen el catálogo a sus números de unidad.

No modifica leads, puntuación, temperatura, SQL ni datos productivos. Los cambios quedan locales hasta publicarse.

Verificación: 201 pruebas de conversación, 222 de integración y 25 de interfaz aprobadas; TypeScript sin errores. Se reprodujo además la validación del borrador completo del evento `85b29169-ec63-41f6-a0e8-9b8c2b7f0323` utilizando sus datos históricos: sin errores de ficha y catálogo válido. Fue una lectura y comprobación local, sin ejecutar de nuevo el envío.
