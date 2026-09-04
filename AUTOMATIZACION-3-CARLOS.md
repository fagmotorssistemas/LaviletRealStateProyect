# La Vilet — Citas al showroom y precalificación bancaria

**Para:** Carlos
**Entrega:** 04-09-3026

Esto va **después** de cerrar lo del documento anterior. Si la credencial de KsiNuevos sigue viva en algún nodo o la rama vieja no está borrada, eso primero y esto después. No arranques encima de una base a medias.

Dos módulos. Igual que siempre: es por dónde arrancar, no un instructivo cerrado. Si encuentras algo mejor, dilo.

---

## Por qué ahora, si todavía no hay nada

El showroom físico no existe aún y el edificio está en construcción. Ese no es motivo para esperar.

Si armamos esto recién cuando todo esté listo, vamos a estar improvisando justo en el momento en que entren los primeros clientes reales. Prefiero tenerlo construido, probado y con los errores ya encontrados, para que el día que abra sea encender y nada más.

Lo mismo con el banco: no vamos a esperar a tener ventas para recién armar el financiamiento.

Construir no es publicar. Lo que se controla es qué queda visible.

Y como está todo por definirse, esto va a cambiar. Que no te frustre. Armalo de forma que se pueda mover.

---

## Lo que te falta, lo gestionas tú

Hay datos que este trabajo necesita y que no vas a encontrar en el código. **Eso lo ves directamente con Juan Diego**, no conmigo:

- Nombre y contacto de la persona del banco
- Confirmación del convenio y en qué estado está
- Las dos vendedoras definidas, con número de WhatsApp

No esperes a que alguien te los pase. Búscalo, pregunta y resuélvelo.

Y aplica el mismo criterio de siempre: **llega con la lógica armada, no preguntando desde cero.** Antes de hablar con él, ten claro para qué necesitas cada dato, qué asumiste mientras tanto y qué se rompe si el dato viene distinto. Una conversación corta con las preguntas concretas rinde más que una larga preguntando qué hacemos.

Mientras tanto, sigue con datos de prueba y déjalo listo para cambiarlos después. No pares por esto.

---

# MÓDULO 1 — Citas y visitas al showroom

## Qué es y qué no es

El ciclo completo de una visita física, sin que nadie se acuerde de nada a mano.

Lo que tiene que pasar solo:

- Se agenda la cita → confirmación inmediata con día, hora y ubicación
- Día anterior → recordatorio
- Unas horas antes → recordatorio corto
- No llegó → mensaje de reagendamiento, no un reproche
- Sí llegó → seguimiento con la información de lo que vino a ver
- Días después → nuevo contacto con material del proyecto

Lo que no es: un recordatorio suelto. Si el sistema solo manda "recuerda tu cita" y ahí muere, no sirve — lo que vale es lo de después de la visita.

## Lo que hay que resolver

**Quién marca que la persona llegó.** El sistema no se entera solo. Alguien tiene que decir "vino" o "no vino", y de ahí sale todo lo demás. Que sea un botón, no un formulario. Si le toma más de tres segundos a la vendedora, no lo va a usar y el módulo entero queda muerto.

**Qué vino a ver.** El mensaje posterior tiene que decir la tipología concreta: *"vimos que te interesó la suite del piso 4, te enviamos más información"*. Ese dato sale de la ficha del lead o de lo que registre la vendedora en la visita. Define de dónde lo tomas y qué pasa si está vacío — porque va a estar vacío muchas veces.

**El estado de la visita.** Agendada, confirmada, asistió, no asistió, reagendada. Cada estado dispara algo distinto o no dispara nada. Que esté en la base y no en la cabeza de nadie.

**Que la ubicación y el horario no estén escritos en el mensaje.** Todavía no sabemos dónde va a ser ni en qué horario se atiende. Que salgan de la configuración del proyecto, para cambiarlos sin tocar el flujo.

## El bloqueo real: las plantillas de Meta

Casi todos estos mensajes salen fuera de la ventana de 24 horas. Un recordatorio del día anterior, un mensaje tres días después de la visita — nada de eso se puede mandar como mensaje libre.

Necesitamos plantillas aprobadas por Meta y la aprobación **no depende de nosotros ni es inmediata**. Esto ya te lo pregunté en el documento anterior y sigue sin respuesta.

Mándalas a aprobar mañana a primera hora, antes de programar nada. Como mínimo: confirmación de cita, recordatorio, reagendamiento por ausencia, seguimiento posterior a la visita. Mientras esperas, el workflow lo dejas armado y probado con el flujo detenido justo antes del envío.

Dime hoy en qué estado están.

---

# MÓDULO 2 — Precalificación bancaria

## El concepto, y esto es lo importante

Nosotros no financiamos. El banco financia. Nosotros **le adelantamos el trámite al cliente**, y eso es lo que genera confianza: que no está solo frente al banco.

La idea es que el cliente no tenga que arrancar de cero. Nosotros armamos su carpeta, la consultamos, y si el banco necesita más o quiere avanzar, se comunica directamente con él.

**El bot nunca dice una tasa ni dice si califica.** Dice que tenemos convenio y que consultamos por él. Si el bot promete algo y el banco después lo niega, perdimos al cliente y quedamos mal. Que hable de acompañamiento, no de números.

## Lo que hay que construir

**La ficha de precalificación.** Los datos que pide el banco ya los sabemos: cédula, estabilidad laboral mínima de un año, certificado de trabajo con antigüedad, cargo e ingresos, roles de pago de los tres meses anteriores. Para independientes: RUC, declaración de renta de los dos últimos años y de IVA de los tres últimos meses.

Que la ficha muestre qué falta y el bot lo vaya pidiendo **de a poco**. Si le sueltas la lista completa de golpe, la persona se va. Un dato por conversación.

**La cola de consultas al banco.** Estados: pendiente, enviada, respondida. Con recordatorio si nadie la mueve en 48 horas.

Es la misma estructura que la cola de traspaso que ya armaste. Reutilízala, no hagas otra.

**La proforma automática en PDF.** Se genera sola con unidad, precio, m², datos del cliente y del proyecto.

## La proforma: esto lo tienes que definir tú y consultarlo

La proforma tiene que salir en dos direcciones: una copia al cliente y una que va con la consulta al banco, para adelantarle el paso y que no tenga que hacer el trámite solo.

**El detalle de cómo se manda al banco hay que confirmarlo con Juan Diego.** Pero no vayas a preguntarle desde cero — llégale con una propuesta armada y que él la corrija.

Lo que quiero que le lleves resuelto de tu lado:

- Cómo sale la proforma: correo, WhatsApp, o carga en algún sistema de ellos
- Si va sola o acompañada de la ficha del cliente
- Qué campos exactos necesita el banco en el documento
- Si aceptan varias consultas juntas o una por cliente
- Qué nos devuelven y en qué formato, para saber cómo lo cargamos de vuelta

Ármalo como debería funcionar según tu criterio, se lo muestras, y ajustas. Una reunión de veinte minutos con una propuesta en la mano rinde más que una hora preguntando qué quieren.

**El simulador, solo interno por ahora.** Cuota estimada según entrada y plazo, para que la vendedora tenga un número en la mano al conversar. Al cliente no le sale todavía.

## Y esto no es opcional

Vamos a guardar ingresos, deudas y roles de pago, y a compartirlos con un tercero. Eso necesita **consentimiento explícito para compartir con el banco**, guardado con fecha. El checkbox general del formulario no cubre esto.

Que el bot lo pida textual antes de recolectar el primer dato. Sin esa autorización registrada, la ficha no se arma y la consulta no sale.

---

## Qué me entregas

**Los dos flujos armados y probados de punta a punta** con un número de prueba. Agendo una cita, la marco como asistida, y quiero ver salir el mensaje de seguimiento con la tipología correcta adentro. Pregunto por financiamiento y quiero ver la ficha armándose sola en la base.

**Tu propuesta de cómo va la proforma al banco,** para llevarla a Juan Diego.

**Media página con tu criterio:** cómo modelaste los estados de la visita, de dónde sale la tipología para el mensaje posterior y qué pasa cuando no hay ninguna, y cómo evitas que a alguien le lleguen dos mensajes distintos el mismo día.

Ese último punto es el que más me importa. Con dos módulos mandando mensajes al mismo lead, alguien va a recibir un recordatorio de cita y un seguimiento de financiamiento con diez minutos de diferencia. Resuélvelo ahora, no cuando pase.
