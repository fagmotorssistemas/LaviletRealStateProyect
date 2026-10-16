export type UnitDwell = {
    unit_id: string;
    seconds: number;
};
/** Approved marketing copy, separate from the conversational writer. */
export function showroomInvitationBody(unitLabel?:string|null){
    return unitLabel
      ? `Hola, le saludamos de La Vilet. Gracias por visitar nuestro showroom virtual. Estuvo revisando ${unitLabel} y nos gustaría ayudarle a conocer más detalles. ¿Le gustaría recibir información sobre este espacio o sobre el proyecto?`
      : 'Hola, le saludamos de La Vilet. Gracias por visitar nuestro showroom virtual. Nos gustaría ayudarle a conocer mejor el proyecto y resolver sus dudas. ¿Le gustaría recibir más información?';
}
/** Browsing provides an observed subject, never an accepted commercial choice. */
export function observedShowroomUnit(rows: UnitDwell[], explicitRequest?: string | null) {
    if (explicitRequest)
        return explicitRequest;
    const ranked = rows.filter(row => row.seconds > 0).sort((a, b) => b.seconds - a.seconds);
    const [top, second] = ranked, total = ranked.reduce((sum, row) => sum + row.seconds, 0);
    return top && top.seconds >= 120 && top.seconds >= total * .5
        && (!second || top.seconds >= second.seconds * 1.5) ? top.unit_id : null;
}
export function showroomButtonReply(value: string): 'information' | 'later' | 'stop' | null {
    const message = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.!¡¿?]/g, '').replace(/\s+/g, ' ').trim();
    if (/^(?:si[, ]+)?(?:quiero|deseo) (?:mas )?informacion$|^si(?:[, ]+(?:por favor|claro))?$/.test(message))
        return 'information';
    if (/^(?:mas adelante|despues|luego)(?:[, ]+por favor)?$/.test(message))
        return 'later';
    if (/^(?:no recibir mensajes|no (?:quiero|deseo) (?:recibir )?(?:mas )?mensajes|parar)$/.test(message))
        return 'stop';
    return null;
}
