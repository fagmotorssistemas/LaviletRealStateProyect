export const TOUR_EVENT_LABELS: Record<string, string> = {
  entrada: 'Entrada',
  salida: 'Salida',
  ambiente: 'Ambiente',
  cambio_acabado: 'Cambio de acabado',
  cambio_luz: 'Cambio de luz',
  hotspot: 'Hotspot',
  minimapa: 'Minimapa',
  fullscreen: 'Pantalla completa',
  vr: 'VR',
  gate_mostrado: 'Formulario mostrado',
  gate_cerrado: 'Formulario cerrado',
  lead_identificado: 'Lead identificado',
}

export function tourEventLabel(type: string) {
  return TOUR_EVENT_LABELS[type] ?? type
}
