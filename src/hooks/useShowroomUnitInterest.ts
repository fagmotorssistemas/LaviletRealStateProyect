'use client';
import { useEffect } from 'react';
import { getTourTrackIds } from '@/lib/tour/visitorTracking';
export function useShowroomUnitInterest(unitId?: string | null, paused = false) {
    useEffect(() => {
        if (!unitId || paused)
            return;
        let lastActivity = Date.now(), lastTick = Date.now();
        const active = () => { lastActivity = Date.now(); };
        const events = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel'] as const;
        for (const name of events)
            window.addEventListener(name, active, { passive: true });
        const timer = setInterval(() => {
            const now = Date.now(), seconds = Math.min(15, Math.floor((now - lastTick) / 1000));
            lastTick = now;
            const ids = getTourTrackIds();
            if (!ids || document.visibilityState !== 'visible' || now - lastActivity > 60000 || seconds < 1)
                return;
            void fetch('/api/tour/unit-interest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: ids.session_id, unit_id: unitId, seconds }) }).catch(() => { });
        }, 10000);
        return () => { clearInterval(timer); for (const name of events)
            window.removeEventListener(name, active); };
    }, [unitId, paused]);
}
