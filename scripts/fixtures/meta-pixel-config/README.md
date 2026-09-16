# Fixture `signals-config` (Meta Pixel)

## Qué es
Respuesta HTTP del endpoint de configuración del Pixel que `fbevents.js` solicita tras `init`:

`GET https://connect.facebook.net/signals/config/{PIXEL_ID}?v={version}&r=stable&domain={host}&…`

Documentación Meta (CSP / Advanced): el Pixel carga scripts desde dos rutas,
`/en_US/fbevents.js` y `/signals/config/{pixelID}?v={version}`.

## Procedencia (no inventar)
Este directorio **no** incluye un cuerpo inventado. El archivo
`923439043758658.json` (o `.js`) solo debe existir si se capturó del CDN de Meta.

Captura controlada (solo laboratorio local):

```bash
# Revisa el aviso de datos en la salida antes de confirmar.
node scripts/meta-pixel-capture-config.cjs --dry-run
# Si aceptas la transmisión descrita:
node scripts/meta-pixel-capture-config.cjs --fetch
```

## Uso en el harness
Con el fixture presente, el harness **sirve la config en local** (fulfill) y
sigue **abortando** toda medición (`/tr`, etc.) y las APIs del proyecto.
Sin fixture, el harness documenta tráfico inconcluso o exige captura.

## Qué NO hacer
- No reutilizar esta respuesta en Production.
- No reenviar el cuerpo a Meta.
- No tratar `signals/config` como evento de conversión (no es `/tr`).
