export type ProjectVisitLocation = { latitude: number; longitude: number }
export function validCoordinates(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}
export function googleMapsUrl(point: ProjectVisitLocation) {
  if (!validCoordinates(point.latitude, point.longitude)) throw new Error('Selecciona un punto válido en el mapa')
  return 'https://www.google.com/maps/search/?api=1&query=' + point.latitude.toFixed(6) + '%2C' + point.longitude.toFixed(6)
}

