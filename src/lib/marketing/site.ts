export const SITE = {
  name: 'Lavilet',
  email: 'contacto@lavilet.com',
  /** Número internacional sin + ni espacios, p. ej. 593991234567. Vacío = el formulario usa correo. */
  whatsapp: '',
  city: 'Ecuador',
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
  { n: '01', title: 'Cuéntanos qué buscas', body: 'Departamento, local o inversión. Presupuesto y zona preferida.' },
  { n: '02', title: 'Visita el showroom', body: 'Recorremos opciones reales y resolvemos cada detalle con calma.' },
  { n: '03', title: 'Reserva con respaldo', body: 'Te acompañamos en la negociación y en la firma del contrato.' },
] as const
