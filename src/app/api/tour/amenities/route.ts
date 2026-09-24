import { NextResponse } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { TOUR_PROJECT_ID } from '@/lib/tour/trackingIds'
export async function GET(){
 const db=tryCreateAdminClient()
 if(!db)return NextResponse.json({error:'No disponible'},{status:503})
 const {data,error}=await db.from('project_amenities').select('amenity_name,description').eq('project_id',TOUR_PROJECT_ID).limit(100)
 if(error)return NextResponse.json({error:'No disponible'},{status:503})
 return NextResponse.json({items:data ?? []},{headers:{'Cache-Control':'no-store'}})
}
