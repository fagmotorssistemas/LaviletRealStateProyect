import type { Row } from '../data'
import { VISIT_PREFERENCE_VERSION } from '../visit-preference-contract'

/** Test data mirrors the typed model contract; it never translates prose. */
export function visitPreferenceFixture(input: Row = {}): Row {
  return { version: VISIT_PREFERENCE_VERSION, decision: 'specified', uncertain_fields: [], location_type: null,
    evidence: 'El miércoles a las 3 de la tarde', confidence: 'high', ...input,
    date: { kind: 'none', year: null, month: null, day: null, offset_days: null, weekday: null, week_offset: null, occurrence: null,
      ...(input.date && typeof input.date === 'object' ? input.date : {}) },
    time: { kind: 'none', hour: null, minute: null, meridiem: null, period: null,
      ...(input.time && typeof input.time === 'object' ? input.time : {}) },
    source: { kind: 'current', message_id: null, ...(input.source && typeof input.source === 'object' ? input.source : {}) } }
}
