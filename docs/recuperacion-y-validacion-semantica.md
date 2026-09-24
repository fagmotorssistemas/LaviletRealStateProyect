# Recuperación y mejoras del redactor — 23/09/2026

## Punto de retorno

Versión anterior confirmada: `37536ac` (main y origin/main al iniciar).

Copia local: `.recovery/automation-1790194183188/` (ignorada por Git).

- `committed-version.zip`: árbol completo de archivos versionados de ese commit.
- `working/`: los 14 archivos tal como estaban, con conflictos.
- `stage1/`, `stage2/`, `stage3/`: base, versión actual y versión del stash.
- `untracked/`: documentos locales no versionados antes del trabajo.
- `index`, `HEAD.txt`, `status.txt`, `diff.patch`: evidencia del estado original. No restaurar el índice manualmente sobre un árbol diferente.

Los conflictos contenían las etiquetas Updated upstream / Stashed changes. Los blobs del stash de 13 archivos eran idénticos al commit histórico `c1149bb`, ancestro de HEAD. El package.json del stash difería de aquel commit solo en quitar una prueba que sí existe hoy. Se conservó stage2 (versión actual) y se marcaron los 14 conflictos como resueltos. No se borró ningún stash.

Para volver funcionalmente al comportamiento anterior, conservar primero cualquier trabajo posterior y preparar una reversión revisable de los archivos modificados contra `37536ac`; no usar reset --hard ni borrar toda la carpeta. El ZIP permite recuperar una copia separada sin tocar el trabajo actual. La carpeta working reproduce el conflicto, no una versión ejecutable.

## Implementación

- Apertura decidida en código antes de redactar, con la regla antirrepetición existente. El redactor recibe la decisión y el formato final también la aplica al fallback. Se reconoce «Claro que sí» como apertura de cortesía.
- Para una pregunta residencial amplia por el máximo de superficie, se libera la preferencia anterior de dormitorios solo cuando no existe esa cantidad en el catálogo, no es obligatoria y no se vuelve a indicar en el turno. Se preserva original_query y se registra query_transition. Otros filtros no se borran indiscriminadamente.
- El resultado de ese ranking puede presentar la mayor vivienda y el máximo de departamentos calculados, si los datos están completos.
- El revisor existente devuelve claims: fragmento, sujeto, polaridad, veredicto y evidencia. Se rechazan resultados no respaldados, contradictorios o mal formados. No se añade otra llamada de revisión ni se unifican intérpretes.
- Sustitución gradual: una negación semánticamente revisada sobre una consulta completa sin resultados puede superar el control lexical de dormitorios. Debe corresponder a la misma consulta y a una oración literal; no puede ocultar URLs ni cifras ajenas a sus filtros. El resto del texto conserva controles de catálogo. No se habilita una exención global para toda la respuesta.
- Se conserva la revisión condicional: respuestas base sin cambios no activan automáticamente una revisión adicional. El respaldo y los revisores no garantizan veracidad absoluta.
- Registro: apertura, cambio de filtros, afirmaciones contrastadas y conteos de tokens reportados por el proveedor, incluida caché, por llamada. No se almacenan claves, instrucciones completas ni se calculan dólares con tarifas supuestas.

## Pendiente por diseño

No se unificaron llamadas; no se incorporaron NLI local, VPS ni slots generales; no se eliminaron todos los controles regex. La ampliación de filtros cubre el caso probado de dormitorios no disponibles, no pretende resolver cualquier cambio ambiguo de alcance. El revisor es probabilístico; sus juicios deben evaluarse con conversaciones reales. Las pruebas automatizadas usan modelos simulados y no miden calidad del proveedor ni costo real. No se envían mensajes, no se alteran leads ni se despliega desde este trabajo.

## Ejemplos esperados

- «Quiero información»: mantener «Claro que sí, con mucho gusto» si la base lo incluía y la regla antirrepetición lo permite.
- Cinco dormitorios no disponibles → «¿Cuál es la vivienda más espaciosa?»: presentar penthouse 602, 3 dormitorios, 142,09 m²; comparar con departamentos de hasta 120,83 m², según el catálogo de prueba.
- «Deben ser obligatoriamente cinco dormitorios»: conservar el requisito; no afirmar que una alternativa de tres lo satisface.
- «La Vilet no cuenta con departamentos disponibles de cinco dormitorios»: permitir variantes de negación cuando el revisor las respalda con la consulta vacía correspondiente. Se prueban tanto «5» como «cinco»; el resto de controles permanece activo.
