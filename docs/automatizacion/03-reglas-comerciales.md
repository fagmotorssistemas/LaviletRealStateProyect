# Reglas comerciales

## Fuentes verificadas

La respuesta comercial se arma con datos del proyecto, no con conocimiento general del modelo.

| Información | Fuente principal |
| --- | --- |
| Unidades, dormitorios, áreas, pisos y disponibilidad | `units` |
| Precios visibles | `unit_prices` y política de precios del proyecto |
| Instalaciones | tablas de amenidades del proyecto |
| Ubicación y mapa | `project_automation_config` y ubicación configurada |
| Estado físico y lugares visitables | `projects.policies_json` |
| Entidades de financiamiento | `project_financing_partners` |
| Hechos positivos del sector | `project_area_facts` cuando estén verificados y autorizados |
| Historial y referencias anteriores | `conversations`, `messages` y resumen persistido |

## Catálogo

- Solo se recomiendan unidades publicadas y disponibles.
- Una unidad mencionada explícitamente se conserva como referencia hasta que el lead cambie de categoría o de unidad.
- Una referencia ambigua no se resuelve escogiendo arbitrariamente la primera coincidencia.
- Si el lead cambia de vivienda a local, o al contrario, se reinician los datos incompatibles de la búsqueda anterior.

## Precios

- En `preventa` se informa el precio publicado de una unidad disponible.
- En `lanzamiento`, la política del proyecto decide si se pueden mostrar precios referenciales.
- Si la visibilidad está desactivada, el bot no inventa ni recupera precios ocultos.
- El validador compara cualquier precio redactado con los valores autorizados del turno.
- Crédito directo y financiamiento bancario son conceptos distintos. El bot no debe repetir “no ofrecemos crédito directo” si el lead no lo pregunta y ese punto ya quedó resuelto.

## Alternativas cuando no existe lo solicitado

La respuesta no está fijada al departamento 202. El sistema debe:

1. explicar brevemente que no existe la característica solicitada;
2. filtrar alternativas reales de la misma categoría;
3. ordenar por el atributo que mejor compensa la ausencia, como superficie o dormitorios;
4. recomendar una unidad concreta con sus datos verificados;
5. explicar por qué puede ajustarse a la necesidad;
6. proponer un siguiente paso relacionado.

Ejemplo de forma, no de respuesta fija:

> Actualmente no contamos con departamentos de 5 dormitorios. La opción más amplia disponible es [unidad], con 3 dormitorios y [área] m² interiores. Podemos mostrarle su distribución para que valore si se adapta a su familia.

La unidad recomendada cambia con el inventario. El número 202 solo sería correcto si realmente gana el criterio aplicado en ese momento.

## Sector y ubicación comercial

Se distinguen dos niveles:

- **sector en la ciudad:** Puertas del Sol, servicios cercanos, carácter residencial y comercial y otros hechos verificados;
- **posición dentro del edificio:** planta, exposición, acceso y características propias del local.

Los textos sobre el sector deben provenir de hechos marcados como `verified` y `approved_for_bot`. No se deben prometer tránsito, rentabilidad, plusvalía o demanda con cifras no verificadas.

La recomendación que combina ubicación, capital inicial y financiamiento está en estado **local pendiente**. Usa `project_area_facts`, compara locales reales y aclara si los USD 50.000 son presupuesto total o capital disponible sin afirmar aprobación crediticia.

## Materiales y tour

- El brochure oficial es `https://www.lavilett.com/materiales/brochure-la-vilet-v5.pdf`.
- Una solicitud de fotos, recorrido, 3D o tour debe entregar un enlace web; no adjuntar imágenes individuales del inventario.
- Si existe una unidad residencial inequívoca, el formato local pendiente es:

```text
https://www.lavilett.com/tour?unidad=001
```

- Si no existe una unidad concreta, el formato es:

```text
https://www.lavilett.com/tour
```

- Si el número no existe o la referencia es ambigua, el bot pregunta cuál unidad desea ver.
- No se envía repetidamente el mismo tour, salvo que el lead lo solicite de nuevo.

Esta sustitución del antiguo envío de galería por enlaces de tour está en estado **local pendiente**.

## Estado del proyecto

- La etapa comercial y el estado físico se leen por separado.
- En lanzamiento no se presentan renders como fotografías de obra terminada.
- Si el estado físico está sin verificar, el bot evita afirmaciones de avance.
- Los lugares visitables se limitan a los autorizados: oficina, terreno, área de obra, modelo o unidad terminada.
- Si no existe lugar autorizado, el bot ofrece resolver dudas por el chat y no crea una visita presencial.
