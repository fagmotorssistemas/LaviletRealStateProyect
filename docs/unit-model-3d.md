# Recorridos 3D por unidad

Enlace público del 202:
`https://www.lavilett.com/tour/modelo-3d/segunda-planta.html?unidad=202`

El HTML autónomo se publica con la aplicación. No requiere sesión, un proceso local,
CDN de Three.js ni una suscripción adicional. Conserva geometría, materiales y
oclusiones del archivo entregado por el responsable del proyecto; la cámara y los
controles muestran exclusivamente la unidad indicada, incluso al repetir el recorrido
o cambiar a vista superior. Los parámetros desconocidos muestran «Modelo no disponible».

## Archivo y catálogo

Fuente: `La-Vilet-Modelo-3D-y-Animacion (2).zip`, entrada `La-Vilet/La-Vilet.html`.
SHA-256 del HTML original: `bb1e3eb10e942799547dcde9239017dc414705cdcc0efa158e9a005ebe650acd`.
El export contiene **201–211**, incluida la unidad 202 con 120,83 m² interiores.
No contiene modelos de otros pisos ni locales. El GLB y el PDF originales no son
necesarios para este visor. Three.js r160 conserva su licencia MIT junto al HTML.

`src/lib/tour/unitModels.ts` vincula cada número con el UUID real del inventario.
El bot solo consulta unidades publicadas y disponibles del proyecto. Compartir una
medida con otro piso no autoriza reutilizar el modelo. Las imágenes se leen mediante
la extracción visual existente; un título incierto o varias coincidencias requieren
aclarar la unidad, sin elegir una por parecido visual.

## Envío

En una consulta comercial con una coincidencia inequívoca, el enlace se añade a la
misma respuesta que ya recorre la cola y el Salesbot de Kommo. No se crea otro emisor,
otra plantilla ni un segundo mensaje. Saludos, cortesías, bajas y la atención humana
conservan sus controles actuales. Las respuestas de citas y financiamiento mantienen
prioridad sobre el contenido promocional.

Los mensajes salientes y `_unit_models_sent` evitan repetir enlaces automáticamente,
incluso cuando el historial se recorta o el resumen se regenera. La memoria se guarda
solo después de que Kommo acepta el envío. Pedir el modelo nuevamente permite reenviarlo.
Un reinicio completo de la conversación elimina esta memoria con el resto del resumen.

## Regeneración y comprobación

Extraer la entrada HTML original a una carpeta temporal y ejecutar:

```powershell
node scripts/build-unit-model.cjs "ruta\La-Vilet.html"
npm.cmd run test:unit-model
npm.cmd run test:integrations
npm.cmd run build
```

El importador rechaza una fuente distinta hasta revisar sus cambios. El controlador
editable está en `scripts/model3d/viewer-runtime.js`. El resultado se guarda en
`public/tour/modelo-3d/segunda-planta.html`. Para nuevas unidades, importar el modelo
correspondiente y extender el registro con su UUID; nunca mapear números nuevos al
modelo del 202 por similitud.

Las pruebas construyen la geometría real con Three.js y sustituyen solo el renderizador
WebGL para comprobar selección, cámara y controles sin GPU. No sustituyen una revisión
visual en un navegador y teléfono reales.
