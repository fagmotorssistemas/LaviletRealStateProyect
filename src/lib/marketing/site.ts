export const SITE = {
  name: 'Lavilet',
  email: 'contacto@lavilet.com',
  /** Número internacional sin + ni espacios, p. ej. 593991234567. Vacío = el formulario usa correo. */
  whatsapp: String(process.env.NEXT_PUBLIC_WHATSAPP ?? '').replace(/\D/g, ''),
  city: 'Cuenca, Ecuador',
  /** Coordenadas del proyecto La Vilet (misma ubicación que visit_location_url). */
  location: {
    label: 'La Vilet',
    address: 'Cuenca, Ecuador',
    lat: -2.89234,
    lng: -79.030352,
    mapsUrl: 'https://maps.app.goo.gl/cjkNv7c4siehTqAN9',
    embedUrl:
      'https://www.google.com/maps?q=-2.892340,-79.030352&hl=es&z=18&output=embed',
  },
}

export const FEATURED_SPACES = [
  {
    title: 'Departamentos',
    phase: 'Preventa y entrega',
    description: 'Viviendas contemporáneas pensadas para vivir y para invertir, con acabados y espacios que se sienten hogar desde el primer recorrido.',
    image:
      'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1400&q=80',
  },
  {
    title: 'Locales comerciales',
    phase: 'En comercialización',
    description: 'Ubicaciones con flujo, visibilidad y metrajes pensados para que tu negocio abra con ventaja.',
    image:
      'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1400&q=80',
  },
  {
    title: 'Proyectos en marcha',
    phase: 'Construcción y entrega próxima',
    description: 'Te mostramos el avance real, las unidades disponibles y el acompañamiento hasta la entrega de llaves.',
    image:
      'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1400&q=80',
  },
] as const

/** Razones de valor en /proyectos: no es solo un edificio. */
export const COMPLETE_PLACE = [
  {
    title: 'Todo a unos pasos',
    body: 'Comercio, terraza, áreas comunes y el parque lineal del Tomebamba forman parte del mismo ritmo diario. Sales menos porque ya estás donde necesitas estar.',
  },
  {
    title: 'Vivir sin fricción',
    body: 'La altura te da vistas; el entorno te da ciudad. Diseñamos para que el día quepas entre casa, trabajo cercano y ocio sin cruzar la mitad de Cuenca.',
  },
  {
    title: 'Una decisión con sentido',
    body: 'Elegirnos no es comprar metros: es entrar a un sitio completo, con acompañamiento hasta la entrega y un lugar que se sostiene solo.',
  },
] as const

export const WHY_LAVILET = [
  {
    n: '01',
    title: 'No es un edificio suelto',
    body: 'Es un conjunto pensado como destino: tipologías, locales y vida compartida en el mismo lugar.',
  },
  {
    n: '02',
    title: 'Menos necesidad de salir',
    body: 'Lo esencial está adentro o a la vuelta. El Tomebamba y el parque lineal son la extensión natural del hogar.',
  },
  {
    n: '03',
    title: 'Decides con evidencia',
    body: 'Tour 360°, showroom y disponibilidad real para que elijas con calma, no con promesas.',
  },
] as const

export const PILLARS = [
  {
    title: 'Asesoría cercana',
    body: 'Un equipo que te guía según tu presupuesto, tu estilo de vida y el momento del proyecto.',
  },
  {
    title: 'Inventario claro',
    body: 'Disponibilidad, metrajes y estados actualizados. Sin sorpresas a mitad del proceso.',
  },
  {
    title: 'Showroom para decidir',
    body: 'Recorre, compara y siente el espacio antes de reservar. Agendamos tu visita.',
  },
  {
    title: 'Hasta la entrega',
    body: 'Te acompañamos en la reserva, el contrato y cada hito hasta que recibes tu unidad.',
  },
] as const

export const STEPS = [
  {
    n: '01',
    title: 'Cuéntanos qué buscas',
    body: 'Departamento, local o inversión. Presupuesto, timing y cómo imaginas tu día en La Vilet.',
    detail:
      'Con eso preparamos tipologías reales: metrajes, vistas al Tomebamba y el momento de cada unidad.',
  },
  {
    n: '02',
    title: 'Recorre sin prisa',
    body: 'Showroom físico o tour 360°. Comparas acabados, plantas y el sitio completo a tu ritmo.',
    detail:
      'No es un catálogo frío: sientes la terraza, el entorno y lo que no necesitas ir a buscar afuera.',
  },
  {
    n: '03',
    title: 'Reserva con respaldo',
    body: 'Negociación, contrato y acompañamiento hasta la entrega de llaves.',
    detail:
      'Un asesor te guía en cada hito para que la decisión se sostenga con claridad, no con urgencia.',
  },
] as const

export const PROCESS_TOUCHPOINTS = [
  {
    title: 'Tour 360°',
    body: 'Entra ya a las tipologías desde casa y filtra lo que sí te gusta antes de agendar.',
    href: '/',
    cta: 'Abrir showroom',
  },
  {
    title: 'Visita con cita',
    body: 'Te recibimos en Cuenca para recorrer con calma y resolver dudas con el equipo.',
    href: '/contacto',
    cta: 'Agendar',
  },
  {
    title: 'Ubicación clara',
    body: 'Puertas del Sol, junto al Tomebamba. Ves el mapa y planificas cómo llegar.',
    href: '/ubicanos',
    cta: 'Ver mapa',
  },
] as const
