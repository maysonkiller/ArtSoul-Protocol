// A listing, bid, floor or transfer is not evidence of a completed purchase.
export function readRecordedNftSale(history, tokenId) {
    if (history?.status !== 'ready' || history.complete === false || !/^\d{1,78}$/.test(String(tokenId))) return null;
    const sales = (Array.isArray(history.events) ? history.events : []).filter(event =>
        event && /^\d{1,78}$/.test(String(event.block_number)) && /^\d{1,10}$/.test(String(event.log_index)) &&
        ['settlement_completed', 'resale_completed'].includes(event.type) &&
        String(event.token_id) === String(tokenId)
    );
    const order = event => [BigInt(event.block_number || 0), BigInt(event.log_index || 0)];
    const latest = sales.reduce((current, event) => {
        if (!current) return event;
        const a = order(event), b = order(current);
        return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]) ? event : current;
    }, null);
    if (!latest) return null;
    const amount = latest.type === 'settlement_completed' ? latest.final_price : latest.price;
    return {
        event: latest,
        amount: typeof amount === 'string' && /^\d+(?:\.\d{1,18})?$/.test(amount) ? amount : null,
        venue: latest.type === 'settlement_completed' ? 'ArtSoul primary auction' : 'ArtSoul marketplace'
    };
}
