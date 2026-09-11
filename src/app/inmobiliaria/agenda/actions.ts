'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { assertCanAccessCrmPath, assertCanWriteCrm, getSessionUser } from '@/lib/auth/session'
import {
  cancelAppointment,
  confirmAppointment,
  createAppointment,
  advisorAcceptRequest,
  advisorProposeRequest,
  markAppointmentAttendance,
  markRequestReviewed,
  rejectVisitRequest,
  requestReassignment,
  reassignVisitRequest,
  acceptClientVisitTime,
} from '@/services/inmobiliaria.service'
import type { AppointmentLocationType } from '@/types/inmobiliaria'

function readableMessage(message: string) {
  const trimmed = message.trim()
  return trimmed.replace(/^.*ERROR:\s*/i, '').replace(/\s+CONTEXT:[\s\S]*$/, '').trim() || trimmed
}

function rethrow(error: unknown, fallback: string): never {
  if (error instanceof Error && error.message) {
    throw new Error(readableMessage(error.message) || fallback)
  }
  if (typeof error === 'object' && error && 'message' in error) {
    throw new Error(readableMessage(String((error as { message?: unknown }).message ?? '')) || fallback)
  }
  throw new Error(fallback)
}

async function withAgendaWrite<T>(work: (client: SupabaseClient) => Promise<T>): Promise<T> {
  await assertCanAccessCrmPath('/inmobiliaria/agenda')
  await assertCanWriteCrm()
  const { supabase } = await getSessionUser()
  try {
    return await work(supabase)
  } catch (error) {
    rethrow(error, 'No se pudo completar la operación')
  }
}

export type ConfirmAppointmentInput = {
  appointmentId: string
  startTime: string
  endTime: string
  responsibleId: string
  meetingPlace: string
  locationType: AppointmentLocationType
  notes?: string
  unitIds?: string[]
}

export async function confirmAppointmentAction(input: ConfirmAppointmentInput) {
  return withAgendaWrite((client) =>
    confirmAppointment(client, {
      appointmentId: input.appointmentId,
      startTime: input.startTime,
      endTime: input.endTime,
      responsibleId: input.responsibleId,
      meetingPlace: input.meetingPlace,
      locationType: input.locationType,
      notes: input.notes ?? '',
      unitIds: input.unitIds ?? [],
    }),
  )
}

export type CreateConfirmedAppointmentInput = {
  tenantId: string
  leadId: string
  projectId: string
  title: string
  startTime: string
  endTime: string
  responsibleId: string
  meetingPlace: string
  locationType?: AppointmentLocationType
  notes?: string
  unitIds?: string[]
}

export async function createConfirmedAppointmentAction(input: CreateConfirmedAppointmentInput) {
  return withAgendaWrite((client) =>
    createAppointment(
      client,
      {
        tenant_id: input.tenantId,
        lead_id: input.leadId,
        project_id: input.projectId,
        title: input.title,
        start_time: input.startTime,
        end_time: input.endTime,
        responsible_id: input.responsibleId,
        meeting_place: input.meetingPlace,
        location_type: input.locationType ?? 'proyecto',
        notes: input.notes ?? '',
      },
      input.unitIds ?? [],
    ),
  )
}

export async function markRequestReviewedAction(requestId: string) {
  return withAgendaWrite((client) => markRequestReviewed(client, requestId))
}

export async function advisorAcceptRequestAction(requestId: string) {
  return withAgendaWrite((client) => advisorAcceptRequest(client, requestId))
}

export async function acceptClientVisitTimeAction(input: {
  requestId: string; startTime: string; endTime: string; sourceMessageId: string
}) {
  return withAgendaWrite((client) => acceptClientVisitTime(client, input))
}

export async function advisorProposeRequestAction(input: {
  requestId: string
  startTime: string
  endTime: string
  notes?: string
}) {
  return withAgendaWrite((client) =>
    advisorProposeRequest(client, {
      requestId: input.requestId,
      startTime: input.startTime,
      endTime: input.endTime,
      notes: input.notes,
    }),
  )
}

export async function requestReassignmentAction(input: { requestId: string; reason: string }) {
  return withAgendaWrite((client) => requestReassignment(client, input))
}

export async function reassignVisitRequestAction(input: { requestId: string; reason: string }) {
  return withAgendaWrite((client) => reassignVisitRequest(client, input))
}

export async function rejectVisitRequestAction(input: { requestId: string; notes?: string }) {
  return withAgendaWrite((client) => rejectVisitRequest(client, input))
}

export type MarkAttendanceInput = {
  expectedUpdatedAt: string
  editReason?: string
  appointmentId: string
  attended: boolean
  notes?: string
  visitedUnitIds?: string[]
}

export async function markAppointmentAttendanceAction(input: MarkAttendanceInput) {
  return withAgendaWrite((client) =>
    markAppointmentAttendance(client, {
      appointmentId: input.appointmentId,
      attended: input.attended,
      expectedUpdatedAt: input.expectedUpdatedAt,
      editReason: input.editReason,
      notes: input.notes,
      visitedUnitIds: input.visitedUnitIds,
    }),
  )
}

export async function cancelAppointmentAction(appointmentId: string, notes?: string) {
  return withAgendaWrite((client) => cancelAppointment(client, appointmentId, notes))
}
