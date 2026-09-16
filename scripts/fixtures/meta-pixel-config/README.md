# Fixture `signals-config` (Meta Pixel)

## Qué es
Respuesta HTTP del endpoint de configuración del Pixel que `fbevents.js` solicita tras `init`:

`GET https://connect.facebook.net/signals/config/{PIXEL_ID}?v={version}&r=stable&domain={host}`

## Procedencia (no inventar)
Los cuerpos `.js` solo existen si se capturaron del CDN de Meta (sin cookies/credenciales del sitio).

```bash
# Lab 127.0.0.1
node scripts/meta-pixel-capture-config.cjs --dry-run
node scripts/meta-pixel-capture-config.cjs --fetch

# Cierre de revisión — dominio de producción
node scripts/meta-pixel-capture-config.cjs --domain=www.lavilett.com --dry-run
node scripts/meta-pixel-capture-config.cjs --domain=www.lavilett.com --fetch
```

Archivos:
- `923439043758658.js` + `.provenance.json` → domain=127.0.0.1
- `923439043758658.www.lavilett.com.js` + `.provenance.json` → domain=www.lavilett.com

## Uso en el harness
`npm run test:meta-pixel-browser` sirve la config del dominio configurado
(`META_PIXEL_HARNESS_DOMAIN`, por defecto `www.lavilett.com`) en local HTTPS,
aborta `/tr`/Open Bridge y simula APIs del proyecto.

## Limitación
Cada fixture es válido solo para el `domain=` con el que se capturó.
No equivaler 127.0.0.1 con www.lavilett.com.

## Qué NO hacer
- No reutilizar en Production como script embebido.
- No reenviar el cuerpo a Meta.
- No tratar `signals/config` como evento (`/tr`).
- No publicar ni activar Pixel real desde el lab.
