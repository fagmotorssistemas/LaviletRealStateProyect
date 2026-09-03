'use server'

import { readOwnProfileRow, type SessionProfileRow } from '@/lib/auth/session'

export type { SessionProfileRow }

export async function getMyProfileAction(): Promise<SessionProfileRow | null> {
  return readOwnProfileRow()
}
