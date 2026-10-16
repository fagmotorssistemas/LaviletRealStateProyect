/** A display alias never confirms a legal or declared identity. */
export function contactDisplayName(name: unknown, whatsappAlias: unknown, phone?: unknown) {
    const readable = (value: unknown) => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 90) : '';
    const usable = (value: string) => !!value && !/^(?:lead(?:\s+kommo)?\s*#?\s*\d+|whatsapp\s*[·.*\d\s]+|sin nombre|contacto sin nombre)$/i.test(value)
        && !/^(?:la\s*vile[t]+|salesbot|bot|tarea automática)$/i.test(value);
    const declared = readable(name), alias = readable(whatsappAlias);
    if (usable(declared))
        return declared;
    if (usable(alias))
        return alias;
    const digits = readable(phone).replace(/\D/g, '');
    return digits.length >= 4 ? `WhatsApp ····${digits.slice(-4)}` : 'Contacto sin nombre';
}
