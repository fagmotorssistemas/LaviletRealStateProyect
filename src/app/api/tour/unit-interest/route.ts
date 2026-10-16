import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { tryCreateAdminClient } from '@/lib/supabase/admin';
import { LV_VID_COOKIE, TOUR_PROJECT_ID, TOUR_TENANT_ID } from '@/lib/tour/trackingIds';
export const runtime = 'nodejs';
export async function POST(request: Request) {
    if (request.headers.get('origin') !== new URL(request.url).origin)
        return NextResponse.json({ error: 'Origen inválido' }, { status: 403 });
    const admin = tryCreateAdminClient(), key = (await cookies()).get(LV_VID_COOKIE)?.value;
    if (!admin || !key)
        return NextResponse.json({ ok: false }, { status: 403 });
    const body = await request.json().catch(() => null) as {
        session_id?: string;
        unit_id?: string;
        seconds?: number;
    } | null;
    if (!body?.session_id || !body.unit_id || !Number.isFinite(body.seconds))
        return NextResponse.json({ ok: false }, { status: 400 });
    const visitor = await admin.from('tour_visitors').select('id').eq('visitor_key', key).eq('tenant_id', TOUR_TENANT_ID).maybeSingle();
    if (visitor.error || !visitor.data)
        return NextResponse.json({ ok: false }, { status: 403 });
    const [session, unit] = await Promise.all([
        admin.from('tour_sessions').select('id').eq('id', body.session_id).eq('visitor_id', visitor.data.id).eq('tenant_id', TOUR_TENANT_ID).maybeSingle(),
        admin.from('units').select('id').eq('id', body.unit_id).eq('tenant_id', TOUR_TENANT_ID).eq('project_id', TOUR_PROJECT_ID).eq('is_published', true).maybeSingle(),
    ]);
    if (session.error || unit.error || !session.data || !unit.data)
        return NextResponse.json({ ok: false }, { status: 403 });
    const result = await admin.rpc('lv_record_showroom_dwell', { p_session_id: session.data.id, p_unit_id: unit.data.id, p_seconds: Math.min(15, Math.max(0, Math.floor(body.seconds!))) });
    return NextResponse.json({ ok: !result.error }, { status: result.error ? 503 : 200 });
}
