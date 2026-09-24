# Idiomas del showroom

El selector español/inglés ahora comparte el idioma entre menú, fichas, filtros, estados, ambientes, terminaciones, comparador, formularios, favoritos, simulador y asistente. Los componentes compartidos del simulador mantienen español fuera del showroom; no cambian cálculos, consentimiento ni eventos comerciales.

- El idioma se guarda en `lang=es|en` y en la preferencia local del navegador. Cambiarlo no vuelve a montar el visor ni cambia la unidad seleccionada.
- Cambiar de unidad conserva `lang`, el fragmento de la vista y el estado del enrutador. Los enlaces compartidos y QR llevan el idioma; la ficha PDF genera sus etiquetas y datos en el idioma elegido.
- Reconocimiento del navegador, transcripción, respuesta contextual y síntesis reciben el idioma. Cambiarlo cancela audio y peticiones anteriores; mantiene las opciones y preferencias de búsqueda.
- Los valores almacenados de estados, unidades, ambientes, superficies y precios conservan su significado e identificadores. Solo cambia su presentación.

## Recursos que requieren contenido traducido

El texto incrustado en planos, imágenes, videos y documentos originales no se modifica. Las descripciones editoriales recibidas del inventario que no tengan una traducción revisada se mantienen en su idioma original; el menú lo informa al elegir inglés. Para traducir estos recursos hacen falta versiones en inglés de los archivos y descripciones originales. No se inventa su contenido ni se contrata un servicio de traducción.

## Revisión local

Abrir `/tour?unidad=001&lang=en`, cambiar idioma en el menú, filtrar unidades, abrir ficha y volver a español. La prueba de navegador usa los componentes reales con inventario simulado en anchos de 1440, 768, 390 y 320 píxeles. Comprueba filtros, selección, etiquetas, QR, recarga y reversibilidad.

Comandos:

```text
node scripts/showroom-language.browser.test.cjs
node --require ./scripts/test-typescript.cjs --test src/lib/tour/tourLanguage.test.ts src/lib/tour/voiceConversation.test.ts src/lib/tour/showroomMenu.test.ts scripts/showroom-voice-contact.test.cjs scripts/showroom-voice-cancellation.test.cjs scripts/showroom-voice-listening.test.cjs
node node_modules/typescript/bin/tsc --noEmit --pretty false
```

Las pruebas de voz sustituyen la red y el micrófono por respuestas controladas. Falta escuchar la voz real en ambos idiomas y probar interrupción con micrófono; no se realizó ninguna llamada de prueba de pago ni un despliegue. Hay incidencias de lint previas en componentes del visor; la comparación de lint con `HEAD` no encontró errores nuevos en los archivos modificados.
