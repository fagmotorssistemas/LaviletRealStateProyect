import type { LeadCardGroup } from '@/lib/inmobiliaria/leadProfileCard'
import type { LeadPipelineSnapshot } from '@/types/leadPipeline'
import type { LeadPipelineIssue } from '@/types/leadPipeline'
import type { LeadProfileCardData } from '@/lib/inmobiliaria/leadProfileCard'

export interface LeadPipelineDetail {
  pipeline: LeadPipelineSnapshot
  groups: LeadCardGroup[]
  appointments: {
    id: string
    status: string
    label: string
    scheduledAt: string | null
    advisor: string | null
    location: string | null
  }[]
  reservations: {
    id: string
    status: string
    unitNumber: string | null
    requestedAt: string | null
  }[]
  financing: { accepted: boolean; partner: string | null; status: string | null }
  jobs: { id: string; task: string; status: string; scheduledAt: string | null }[]
  history: {
    id: string
    at: string
    actor: string | null
    reason: string
    fromStage: string | null
    toStage: string | null
  }[]
  metadataAvailable: boolean
  canEdit?: boolean
  financialReview?: LeadProfileCardData
  metadata: LeadPipelineMetadataInput
  warnings: string[]
  issues?: LeadPipelineIssue[]
}

export type LeadPipelineDetailResult = { ok: true; data: LeadPipelineDetail } | { ok: false; error: string }

export interface LeadPipelineMetadataInput {
  leadId: string
  nutritionActive: boolean
  nutritionReason: string
  purchaseHorizon: string
  nutritionEvidence: string
  contactConsent: boolean
  resumeAt: string | null
  nextAction: string
  nextActionAt: string | null
  opportunityStatus: 'open' | 'lost'
  closureReason: string
}

export type LeadPipelineMetadataResult = { ok: true } | { ok: false; error: string }
