export function acceptsKommoTestContactBatch(
  configuredContactId: string | undefined,
  contactIds: number[],
): boolean {
  const allowed = Number(configuredContactId || '')
  if (!Number.isSafeInteger(allowed) || allowed <= 0) return true
  return contactIds.length > 0 && contactIds.every(contactId => contactId === allowed)
}
