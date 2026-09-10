export function polygonToSvgPoints(polygon: [number, number][]): string {
  return polygon.map(([x, y]) => `${x},${y}`).join(' ')
}
