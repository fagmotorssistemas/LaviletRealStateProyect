# Evidencia por campaña y anuncio: revisión pendiente de Kommo

## Comprobación real de solo lectura

Consultado mediante MCP Supabase, proyecto xhjnyntywqhczdtecgim. Período de adquisición: 24 agosto a 23 septiembre de 2026, Ecuador (desde 2026-08-24T05:00:00Z hasta, excluido, 2026-09-24T05:00:00Z). Las 23 fichas consultadas pertenecen al negocio a1b2c3d4-0001-4000-8000-000000000001.

Se contrastaron relaciones de atribución guardadas por contacto/conversación e interacciones, mensajes de las conversaciones y libro de puntuación. Ocho fichas tienen primer anuncio guardado 52625518901665, Casa De Tarqui. Quince no tienen anuncio identificado en estas fuentes. No se usaron nombres ni teléfonos para reasignar personas.

| Ficha comercial Kommo de Casa De Tarqui | Mensajes entrantes CRM | Salientes CRM | Eventos de puntuación |
| --- | ---: | ---: | ---: |
| 4616560 | 4 | 0 | 0 |
| 4616928 | 1 | 0 | 0 |
| 4618720 | 2 | 0 | 0 |
| 4623850 | 4 | 0 | 0 |
| 4625786 | 2 | 0 | 0 |
| 4626684 | 3 | 0 | 0 |
| 4627288 | 1 | 0 | 0 |
| 4631664 | 1 | 0 | 0 |

Las ocho tienen temperature_updated_at nulo. El valor frio y cero puntos por defecto no es una evaluación. Los 18 eventos entrantes correspondientes terminaron completed, con action=outside_test_lead y message_persisted=true. Esto prueba registro entrante y omisión del flujo fuera del contacto de prueba, no procesamiento de interés ni ausencia de respuestas en Kommo. No se cambió la configuración de prueba ni se ejecutó el trabajador.

El grupo diferente de ocho fichas con contenido saliente local no tiene anuncio identificado: 3401838, 4453798, 4454162, 4429474, 4453354, 4469212, 4453096 y 3587844. Sus 54 registros son del bot: 29 con estado accepted y 25 sin estado. Estos estados no demuestran envío. Ninguna de estas fichas debe sumarse a Casa De Tarqui por tener una respuesta local. El diario kommo_message_evidence todavía no existe remotamente.

Conclusión limitada a las fuentes consultadas: ocho adquisiciones publicitarias guardadas; para ellas, ocho atenciones por comprobar y ocho intereses sin evaluar. No equivale a ocho personas sin responder ni a ocho frías. No se ha contrastado aún el historial original ni se certifica identidad original frente a Kommo.

## Cambio local

La carga de atención publicitaria se limita desde el servidor a IDs con primer origen publicitario guardado. El agrupador aplica campaña/anuncio antes de generar todos los conjuntos. Tarjetas, campañas, anuncios, totales y detalles reutilizan esos IDs. Los contadores incompletos muestran cantidades comprobadas y un enlace separado a las personas por comprobar, ambos respetando el filtro. Cero comprobados describe evidencia disponible, no el resultado de las personas desconocidas.

Regresiones: 18 pruebas de agregación, atención e interés correctas; incluyen explícitamente ocho personas de otro origen frente a ocho adquisiciones del anuncio. Navegador escritorio/móvil: filtros, contadores, listas exactas, cantidades desconocidas y apertura de grupos vacíos. TypeScript y ESLint correctos. Estas pruebas son simuladas y no sustituyen el contraste real anterior ni el pendiente con Kommo.

## Paso privado para habilitar Kommo

1. Como administrador de lavilet.kommo.com, abrir Configuración → Integraciones → integración privada → Keys and scopes. Puede utilizarse una integración autorizada existente. Habilitar el acceso al CRM y External chat history. No se necesita Sending to external chats para esta auditoría.
2. Generar un token de larga duración con el alcance autorizado. Guardarlo privadamente en D:\FrontLaVilet\.env.local como KOMMO_ACCESS_TOKEN. Configurar también KOMMO_BASE_URL=https://lavilet.kommo.com. No pegar el token en el chat. Se comprobó con git check-ignore que .env.local está excluido de Git; no se inspeccionó su contenido.
3. Ejecutar desde D:\FrontLaVilet: node scripts/kommo-access-check.cjs. El comprobador carga las variables sin imprimirlas; consulta cuenta, relación ficha/contacto, conversaciones y mensajes. El resultado actual es KOMMO_CREDENTIALS_MISSING.
4. Un acceso exitoso a fichas no demuestra acceso a mensajes. La consulta GET /api/v4/talks/{talk_id}/messages requiere External chat history y un plan compatible. El comprobador informa el HTTP recibido sin revelar secretos. Tras habilitar el acceso, la auditoría completa debe recorrer las páginas y revisar cada conversación; una conversación accesible no certifica todas las demás.

Referencias oficiales consultadas: https://developers.kommo.com/docs/private-integration, https://developers.kommo.com/docs/long-lived-token, https://developers.kommo.com/reference/get-conversation-messages, https://developers.kommo.com/reference/chats-api-add-on.

No hubo escrituras remotas, recuperación, migración, commit, push o despliegue. La funcionalidad continúa incompleta hasta contrastar las respuestas originales y revisar las evaluaciones ausentes con evidencia suficiente.
