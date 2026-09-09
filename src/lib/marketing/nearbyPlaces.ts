export type NearbyPlace = {
  id: string
  title: string
  subtitle: string
  body: string
  tag: string
}

/** Qué queda cerca — solo en carrusel, no en el mapa. */
export const NEARBY_PLACES: NearbyPlace[] = [
  {
    id: 'tomebamba',
    title: 'Río Tomebamba',
    subtitle: 'A pocos pasos',
    body: 'El paisaje que ordena el día: agua, luz y verde sin salir del barrio.',
    tag: 'Naturaleza',
  },
  {
    id: 'parque-lineal',
    title: 'Parque lineal',
    subtitle: 'Puertas del Sol',
    body: 'Caminar, correr o quedarte mirando: la extensión natural del edificio.',
    tag: 'Al aire libre',
  },
  {
    id: 'ordonez',
    title: 'Av. Ordóñez Lasso',
    subtitle: 'Eje cercano',
    body: 'Comercio y servicios del día a día a un trayecto corto.',
    tag: 'Servicios',
  },
  {
    id: 'barrio',
    title: 'Puertas del Sol',
    subtitle: 'El sector',
    body: 'Entorno residencial pensado para quedarte, no para cruzar toda la ciudad.',
    tag: 'Barrio',
  },
  {
    id: 'americas',
    title: 'Av. de las Américas',
    subtitle: 'Conexión urbana',
    body: 'Salida clara hacia el resto de Cuenca cuando sí quieras moverte.',
    tag: 'Movilidad',
  },
  {
    id: 'terraza',
    title: 'Vida del edificio',
    subtitle: 'Terraza y comunes',
    body: 'Lo que un departamento no alcanza solo, lo reúne el sitio completo.',
    tag: 'En casa',
  },
]
