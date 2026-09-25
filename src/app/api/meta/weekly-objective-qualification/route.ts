import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { secretMatches } from '@/lib/integrations/automation/config'
import { buildWeeklyObjectiveQualification } from '@/services/weeklyObjectiveQualification.service'

export const runtime='nodejs'
export const dynamic='force-dynamic'

export async function GET(request:NextRequest){
  const token=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||''
  if(!secretMatches(token,process.env.CRON_SECRET||process.env.AUTOMATION_CRON_SECRET))return NextResponse.json({ok:false},{status:401})
  const admin=createAdminClient()
  const {data,error}=await admin.from('tenants').select('id')
  if(error)return NextResponse.json({ok:false,reason:'tenant_read_failed'},{status:503})
  const report=await buildWeeklyObjectiveQualification(admin,(data||[]).map(row=>String(row.id)),true)
  return NextResponse.json({ok:true,enabled:report.enabled,target:report.target,rows:report.rows.map(row=>({objectiveId:row.objectiveId,own:row.own,incorporated:row.incorporated,eligible:row.eligible,selected:row.selected,pending:row.pending,sent:row.sent,metaAccepted:row.metaAccepted,missing:row.missing}))})
}
