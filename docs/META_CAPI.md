# Meta Pixel + CAPI — variables del frontend (Vercel)

## Qué queda en Vercel

| Variable | Tipo | Rol |
|---|---|---|
| `NEXT_PUBLIC_META_PIXEL_ID` | Pública | Pixel en navegador (`923439043758658`) |
| `META_CAPI_BACKEND_URL` | Server-only | Base del backend en DigitalOcean, con `/api` |
| `META_CAPI_INTERNAL_SECRET` | Server-only | Auth Vercel → DO (mismo valor que en DO) |
| `NEXT_PUBLIC_COOKIE_BANNER_ENABLED` | Pública | Consentimiento ads |

## Qué migrar fuera de Vercel → DigitalOcean

| Variable | Destino |
|---|---|
| `META_CAPI_ACCESS_TOKEN` | Solo DigitalOcean (`lavilet-meta-capi`) |
| `META_DATASET_ID` | Solo DigitalOcean |
| `META_TEST_EVENT_CODE` | Solo DigitalOcean (modo test) |

Tras migrar, eliminar esas tres del proyecto Vercel para no sugerir que el front envía CAPI.

## Referencias

- Backend: `../lavilet-meta-capi/docs/DEPLOY_DIGITALOCEAN.md`
- Backend README: `../lavilet-meta-capi/README.md`
