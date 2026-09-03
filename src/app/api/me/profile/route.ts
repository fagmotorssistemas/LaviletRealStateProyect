import { NextResponse } from 'next/server'
import { readOwnProfileRow } from '@/lib/auth/session'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const profile = await readOwnProfileRow()
    return NextResponse.json({ profile })
  } catch (error) {
    console.error('GET /api/me/profile', error)
    return NextResponse.json({ profile: null }, { status: 200 })
  }
}
