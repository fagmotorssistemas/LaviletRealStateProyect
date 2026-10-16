import 'server-only';
/** Optional transport hint. Failure must never abort or retry the conversation. */
export async function showWhatsAppTyping(messageId: string, send: typeof fetch = fetch) {
    const token = process.env.WHATSAPP_CLOUD_ACCESS_TOKEN, phone = process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID, version = process.env.WHATSAPP_GRAPH_VERSION;
    if (!token || !phone || !/^\d+$/.test(phone) || !/^v\d+\.\d+$/.test(version || ''))
        return { shown: false, reason: 'channel_not_configured' };
    if (!/^wamid\.[A-Za-z0-9+/=_-]+$/.test(messageId))
        return { shown: false, reason: 'meta_message_id_unavailable' };
    try {
        const response = await send(`https://graph.facebook.com/${version}/${phone}/messages`, { method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId, typing_indicator: { type: 'text' } }), signal: AbortSignal.timeout(1500) });
        return { shown: response.ok, reason: response.ok ? 'accepted' : 'provider_rejected' };
    }
    catch {
        return { shown: false, reason: 'typing_unavailable' };
    }
}
