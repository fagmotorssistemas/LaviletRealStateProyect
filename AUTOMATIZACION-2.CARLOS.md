# La Vilet — Qué tener en cuenta

**Para:** Carlos

Son los puntos que importan y las preguntas que tienes que responderte tú mismo mirando lo que ya construiste.

---

## El objetivo, para que todo se mida contra esto

La Vilet está en **lanzamiento**. El objetivo de esta etapa no es vender: es **crear expectativa y construir una base de interesados** antes de que el producto exista.

Las cinco etapas son:

```
LANZAMIENTO → PRECALIFICACIÓN → NUTRICIÓN → PREVENTA → RESERVA/VENTA
```

En lanzamiento no se pregunta presupuesto de entrada. Se genera curiosidad, se capta el contacto y se consigue permiso para seguir escribiendo. La precalificación viene después, y de a poco: qué le interesa, si es para vivir o invertir. La nutrición es lo que sostiene el interés durante los meses de obra. Recién en preventa aparecen precios, unidades y financiamiento.

Todo lo que sigue se juzga contra eso.

---

## Autoevaluación: contéstate esto antes de tocar nada

No me las respondas a mí por escrito si no quieres. Pero si alguna te deja dudando, ahí está el trabajo de mañana.

1. **¿El bot que tengo hoy es de La Vilet o es el de KsiNuevos con otro nombre?** Abre el flujo y busca cuántos nodos siguen hablando de vehículos, marcas, placas o retomas.

2. **Si un cliente entra hoy y pregunta el precio, ¿qué le responde?** ¿Y de dónde saca ese dato?

3. **¿Un lead de lanzamiento puede llegar a tibio?** Suma los puntos que realmente puede disparar en esta etapa, sabiendo que el bot no puede hablar de precio ni de fecha de entrega. Si el techo queda debajo del corte, el embudo no se mueve nunca.

4. **Si un lead se pone caliente ahora mismo, ¿quién se entera y cómo?** Sigue el camino completo hasta el celular de la vendedora.

5. **Si un lead no escribe en 10 días, ¿qué le pasa?** ¿Baja de temperatura? ¿Recibe algo? ¿Quién lo dispara?

6. **¿Qué parte de esto funciona sin que yo aprete nada?** Todo lo que dependa de que alguien recuerde ejecutarlo, no está terminado.

---

## Lo que sé que hay que corregir

**Hay nodos escribiendo en la base de KsiNuevos.** Credencial `ksi nuevos` en lugar de `lavilet`, en varios nodos de la rama vieja. Esto es lo primero y no puede esperar.

**Conviven dos bots en el mismo workflow.** La cadena nueva por RPCs está bien. Pero en paralelo sigue corriendo el analizador automotriz, el análisis de fotos de vehículos y la lógica de retoma. Mi consejo: duplica el flujo y borra la rama vieja de una vez, en vez de ir corrigiendo nodo por nodo — así no se te escapa ninguno apuntando a la base equivocada.

**Dos sistemas de temperatura pisándose.** La base calcula el puntaje con las reglas y el historial. Después otra rama lo recalcula con una escala distinta en JavaScript y sobrescribe el resultado. La temperatura la calcula la base y nadie más.

**Falta la configuración del proyecto.** `project_automation_config` está vacía: sin timezone, horario ni admin, toda la lógica de horario de atención y de escalamiento está inerte aunque el código exista.

**Nada corre solo.** El decaimiento, la cola de traspaso y la nutrición no tienen quién los dispare. Decide si va por pg_cron o por schedule en n8n y déjalo andando.

**`phone_normalized` depende del workflow.** Debería ser un trigger en la base. Es el campo con el que Pablo cruza la atribución: si un lead entra por otro camino y queda sin normalizar, Meta nunca lo ve.

**La nutrición no existe todavía.** Sin plantillas aprobadas por Meta no hay nutrición fuera de la ventana de 24 horas, por más que el workflow esté perfecto. Dime en qué estado están.

---

## Roles y vendedores

No hace falta tabla nueva. Ya está resuelto entre `profiles` (la persona y su rol) y `project_salespeople` (quién atiende este proyecto, con `receives_leads` y `rotation_order`). Mantén esa separación: alguien puede ser asesor en la empresa y no recibir leads de La Vilet.

Hoy ningún perfil tiene número de WhatsApp cargado ni recibe leads. Sin número no hay a dónde notificar un traspaso.

Para mañana: las dos vendedoras dadas de alta y en rotación, un perfil admin apuntado desde la configuración del proyecto, y el mapeo de responsables saliendo de la tabla en lugar del objeto hardcodeado en el nodo. Los perfiles de prueba que sobren, desactívalos — **no borres nada sin avisarme**.

---

## Dos cosas que no estaban en la especificación

**Qué pasa cuando una vendedora no está.** La rotación asume dos personas siempre disponibles. Tiene que ser fácil apagar a una y seguir funcionando con la otra.

**Qué pasa si el lead vuelve después del traspaso.** El bot ya se calló. Si el cliente escribe tres días después y la vendedora no está, ¿queda sin respuesta? Mi criterio: el bot acusa recibo pero no vuelve a conversar. Dime si estás de acuerdo.

**Aparte:** `units_embeddings` y `n8n_chat_histories` tienen RLS desactivado — cualquiera con la anon key lee el historial de conversaciones. Hay que cerrarlo, pero define las políticas primero: activar RLS sin políticas bloquea todo y tumba el flujo.

---

## La demostración

Cuando digas que está listo: número de prueba, recorrido completo delante mío, y al terminar abrimos la base y vemos las filas que se crearon solas. El motivo de cada cambio tiene que decir qué pasó, no "actualizado".
