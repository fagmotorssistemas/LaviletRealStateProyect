/** Relaciones justificadas exclusivamente por el significado persistido de lead_scoring_rules. */
export const WEEKLY_OBJECTIVE_DEFINITIONS = [
  { objectiveId:'commercial_interest', label:'Interés comercial', eventTypes:['asked_price','asked_delivery_date','asked_location_features','declared_purchase_purpose','declared_unit_type'] },
  { objectiveId:'financing', label:'Financiamiento', eventTypes:['asked_financing'] },
  { objectiveId:'visit', label:'Visita', eventTypes:['requested_visit','appointment_confirmed'] },
  { objectiveId:'reservation', label:'Reserva', eventTypes:['asked_reservation'] },
  { objectiveId:'tour_engagement', label:'Interacción con tour', eventTypes:['tour360_iniciado','tour360_3min','tour360_completo','tour360_acabado','tour360_retorno'] },
] as const

export const WEEKLY_OBJECTIVE_UNMAPPED_RULES = ['first_response','nutrition_response','decay_7d','decay_14d'] as const
export const WEEKLY_OBJECTIVE_TARGET = 50
