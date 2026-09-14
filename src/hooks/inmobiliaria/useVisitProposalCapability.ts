'use client'

import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

export function useVisitProposalCapability(client: SupabaseClient, enabled: boolean) {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    let active = true
    if (!enabled) return
    void client.rpc('lv_visit_options_capabilities').then(({ data, error }) => {
      if (active) setAvailable(!error && data?.version === 1)
    })
    return () => { active = false }
  }, [client, enabled])
  return available
}
