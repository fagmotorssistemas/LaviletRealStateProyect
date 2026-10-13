import { object, text, type Row } from './data'

/** An actual selected-unit tour delivery authorizes this unit's price only.
 * An offered unit, general tour or past selection does not open catalogue prices. */
export function selectedTourPrice(verified: Row, audit: Row): Row | null {
  const tour = object(audit.unit_model), context = object(verified.property_context)
  if (object(verified.politica_comercial).precios_autorizados !== true || tour.delivery_required !== true
    || tour.delivery_reason !== 'selected_unit' || !text(tour.url) || !text(tour.unit_id)
    || !Array.isArray(context.selected_ids) || context.selected_ids.length !== 1
    || context.selected_ids[0] !== tour.unit_id) return null
  const units = [verified.catalogo_verificacion, verified.catalogo, object(audit.catalog_results).units]
    .flatMap(value => Array.isArray(value) ? value.map(object) : [])
  const unit = units.find(value => value.id === tour.unit_id)
  if (!unit || unit.is_published !== true || unit.status !== 'disponible'
    || text(unit.unit_number) !== text(tour.unit_number) || typeof unit.published_commercial_price !== 'number'
    || !Number.isFinite(unit.published_commercial_price) || unit.published_commercial_price <= 0) return null
  return { unit_id: unit.id, unit_number: unit.unit_number, published_commercial_price: unit.published_commercial_price }
}
