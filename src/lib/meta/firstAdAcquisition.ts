/** A saved referral is evidence of an interaction, never an individual impression. */
export type SavedAdOrigin = {
  leadId: string
  adId: string
  recordedAt: string
  sourceUrl: string | null
  key: string
  externalMessageId?: string | null
}

export function firstAdOrigins(origins: SavedAdOrigin[]): Map<string, SavedAdOrigin> {
  const first = new Map<string, SavedAdOrigin>()
  // PostgreSQL timestamps have microseconds. Date.parse alone truncates them and
  // could reorder two saved origins within the same millisecond by random UUID.
  const microseconds=(value:string)=>{
    const fraction=String(value).match(/\.(\d+)/)?.[1] || ''
    return BigInt(Date.parse(value))*BigInt(1000)+BigInt(fraction.padEnd(6,'0').slice(3,6))
  }
  for (const origin of origins.filter(o => /^\d+$/.test(o.adId) && Number.isFinite(Date.parse(o.recordedAt))).sort((a, b) =>
    Number(microseconds(a.recordedAt)-microseconds(b.recordedAt)) || a.key.localeCompare(b.key))) {
    if (!first.has(origin.leadId)) first.set(origin.leadId, origin)
  }
  return first
}
