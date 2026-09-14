# Carga de precios solicitada el 13 de septiembre de 2026

Se aplicó la escala indicada por el usuario: suites por encima de USD 200.000 con incremento por piso y viviendas cuyo número comienza en 6 por encima de USD 500.000. Los importes son una configuración solicitada, no una tasación de mercado.

| Unidades | Cantidad | Precio total por unidad, USD |
| --- | ---: | ---: |
| Suites de planta baja | 2 | 210.000 |
| Suites del piso 2 | 10 | 250.000 |
| Suites del piso 3 | 8 | 270.000 |
| Suites del piso 4 | 8 | 290.000 |
| Suites del piso 5 | 8 | 310.000 |
| Unidades 601–606 | 6 | 550.000 |

Se verificaron 42 precios guardados en `units.published_commercial_price`. Las otras 23 unidades (16 locales y 7 departamentos de otros pisos) conservaron sus registros. No se cambió la categoría, publicación ni disponibilidad de ninguna unidad. El modo comercial seguía en Lanzamiento tras la operación, por lo que los precios cargados aún no se comunican mediante el bot.

El comando `node scripts/set-lavilet-suite-prices.cjs` permite revisar la operación sin guardar. Con `--apply` solo completa precios vacíos y rechaza un precio existente que sea diferente. Comprueba el catálogo esperado, guarda una copia local en `tmp/lavilet-prices-before-*.json`, aplica cada cambio condicionado a la versión leída y verifica el resultado. No es una regla automática para nuevas unidades ni una operación transaccional de todo el lote; un error informa las unidades que ya se actualizaron.

La copia anterior a esta carga quedó en `tmp/lavilet-prices-before-2026-09-14T00-15-35-331Z.json` (fecha UTC; 13 de septiembre en Ecuador).
