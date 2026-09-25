export type WeeklyObjectiveScoringRule = {
  eventType: string
  points: number
  active: boolean
  repeatable: boolean
}

export type WeeklyObjectiveEvidence = {
  evidenceId: string
  eventType: string
  occurredAt: string
}

export type WeeklyObjectiveContact = {
  contactId: string
  primaryGroupId: string
  labels: string[]
  temperature: 'frio' | 'tibio' | 'caliente'
  qualifiedAt: string | null
  evidence: WeeklyObjectiveEvidence[]
}

export type WeeklyObjectiveConfig = {
  objectiveId: string
  ownGroupId: string
  eligibleEventTypes?: string[] | null
  weeklyTarget?: number
  windowStart: string
  windowEnd: string
}

export type WeeklyObjectiveSelection = {
  status: 'ready' | 'configuration_pending'
  objectiveId: string
  ownContactIds: string[]
  incorporatedContactIds: string[]
  own: number
  incorporated: number
  total: number
  missingToTarget: number
  target: number
  configurationPending: string[]
  objectiveScores: Record<string, number>
}

const validDate = (value: string) => Number.isFinite(Date.parse(value))
const inWindow = (value: string, start: number, end: number) => {
  const time = Date.parse(value)
  return Number.isFinite(time) && time >= start && time < end
}

function scoreForObjective(
  contact: WeeklyObjectiveContact,
  rules: Map<string, WeeklyObjectiveScoringRule>,
  eligible: Set<string>,
  start: number,
  end: number,
) {
  const evidenceIds = new Set<string>()
  const nonRepeatable = new Set<string>()
  let score = 0
  for (const evidence of [...contact.evidence].sort((a, b) =>
    Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.evidenceId.localeCompare(b.evidenceId))) {
    if (!evidence.evidenceId.trim() || evidenceIds.has(evidence.evidenceId) ||
      !eligible.has(evidence.eventType) || !inWindow(evidence.occurredAt, start, end)) continue
    evidenceIds.add(evidence.evidenceId)
    const rule = rules.get(evidence.eventType)
    if (!rule?.active || !Number.isFinite(rule.points) || rule.points < 0) continue
    if (!rule.repeatable && nonRepeatable.has(rule.eventType)) continue
    nonRepeatable.add(rule.eventType)
    score += rule.points
  }
  return score
}

/** Califica contactos para un objetivo; no crea conversiones ni acciones comerciales. */
export function selectWeeklyContactsForObjective(
  contacts: WeeklyObjectiveContact[],
  scoringRules: WeeklyObjectiveScoringRule[],
  config: WeeklyObjectiveConfig,
): WeeklyObjectiveSelection {
  const target = Number.isInteger(config.weeklyTarget) && Number(config.weeklyTarget) > 0
    ? Number(config.weeklyTarget) : 50
  const pending: string[] = []
  if (!config.objectiveId.trim()) pending.push('objective_id')
  if (!config.ownGroupId.trim()) pending.push('own_group_id')
  if (!Array.isArray(config.eligibleEventTypes) || config.eligibleEventTypes.length === 0) pending.push('eligible_event_types')
  if (!validDate(config.windowStart) || !validDate(config.windowEnd) ||
    Date.parse(config.windowStart) >= Date.parse(config.windowEnd)) pending.push('weekly_window')
  const uniquePending = [...new Set(pending)]
  if (uniquePending.length) return { status: 'configuration_pending', objectiveId: config.objectiveId,
    ownContactIds: [], incorporatedContactIds: [], own: 0, incorporated: 0, total: 0,
    missingToTarget: target, target, configurationPending: uniquePending, objectiveScores: {} }

  const start = Date.parse(config.windowStart), end = Date.parse(config.windowEnd)
  const eligible = new Set(config.eligibleEventTypes)
  const rules = new Map(scoringRules.filter(rule => rule.active && eligible.has(rule.eventType))
    .map(rule => [rule.eventType, rule]))
  const missingRules = [...eligible].filter(eventType => !rules.has(eventType))
  if (missingRules.length) return { status: 'configuration_pending', objectiveId: config.objectiveId,
    ownContactIds: [], incorporatedContactIds: [], own: 0, incorporated: 0, total: 0,
    missingToTarget: target, target,
    configurationPending: missingRules.map(eventType => `scoring_rule:${eventType}`), objectiveScores: {} }

  const byContact = new Map<string, WeeklyObjectiveContact>()
  for (const contact of contacts) if (contact.contactId.trim() && !byContact.has(contact.contactId)) {
    byContact.set(contact.contactId, contact)
  }
  const scored = [...byContact.values()].map(contact => ({ contact,
    score: scoreForObjective(contact, rules, eligible, start, end) }))
  const own = scored.filter(({ contact, score }) => contact.primaryGroupId === config.ownGroupId
      && ['tibio', 'caliente'].includes(contact.temperature) && score > 0)
    .sort((a, b) => (a.contact.temperature === b.contact.temperature ? 0 : a.contact.temperature === 'caliente' ? -1 : 1)
      || b.score - a.score || a.contact.contactId.localeCompare(b.contact.contactId))
  const selected = new Set(own.map(item => item.contact.contactId))
  const incorporated = scored.filter(({ contact, score }) => contact.primaryGroupId !== config.ownGroupId
      && ['tibio', 'caliente'].includes(contact.temperature)
      && score > 0 && !selected.has(contact.contactId))
    .sort((a, b) => b.score - a.score || a.contact.contactId.localeCompare(b.contact.contactId))
  incorporated.forEach(item => selected.add(item.contact.contactId))
  const objectiveScores = Object.fromEntries([...own, ...incorporated]
    .map(item => [item.contact.contactId, item.score]))
  const total = own.length + incorporated.length
  return { status: 'ready', objectiveId: config.objectiveId,
    ownContactIds: own.map(item => item.contact.contactId),
    incorporatedContactIds: incorporated.map(item => item.contact.contactId),
    own: own.length, incorporated: incorporated.length, total,
    missingToTarget: Math.max(0, target - total), target,
    configurationPending: [], objectiveScores }
}
