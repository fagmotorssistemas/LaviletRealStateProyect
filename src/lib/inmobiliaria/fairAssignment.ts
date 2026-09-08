export type FairAdvisorStat = {
  id: string
  count: number
  lastAssignedAt: string | null
}

/** Misma regla que lv_assign_appointment_fairly: menos citas distintas, luego más tiempo sin recibir, luego uuid. */
export function pickFairAdvisor(candidates: FairAdvisorStat[]): string | null {
  if (!candidates.length) return null
  return [...candidates].sort((left, right) => {
    if (left.count !== right.count) return left.count - right.count
    if (left.lastAssignedAt === null && right.lastAssignedAt !== null) return -1
    if (left.lastAssignedAt !== null && right.lastAssignedAt === null) return 1
    if (left.lastAssignedAt !== right.lastAssignedAt) {
      return String(left.lastAssignedAt).localeCompare(String(right.lastAssignedAt))
    }
    return left.id.localeCompare(right.id)
  })[0].id
}

export function simulateFairRound(advisorIds: string[], n: number) {
  const stats: FairAdvisorStat[] = advisorIds.map((id) => ({
    id,
    count: 0,
    lastAssignedAt: null,
  }))
  const assignments: string[] = []
  for (let index = 0; index < n; index += 1) {
    const pick = pickFairAdvisor(stats)
    if (!pick) break
    const row = stats.find((item) => item.id === pick)
    if (!row) break
    row.count += 1
    row.lastAssignedAt = String(index).padStart(6, '0')
    assignments.push(pick)
  }
  return {
    assignments,
    counts: Object.fromEntries(stats.map((item) => [item.id, item.count])),
  }
}
