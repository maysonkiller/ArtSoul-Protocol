const ORIGIN = 'https://artsoulprotocol.com';
const text = (value, limit) => Array.from(String(value || '').replace(/\s+/g, ' ').trim()).slice(0, limit).join('');
const amount = value => {
    const raw = String(value ?? '');
    return /^\d{1,20}(?:\.\d{1,18})?$/.test(raw) && /[1-9]/.test(raw) ? raw : '';
};

export function artworkShareDetails(artwork, now = Date.now()) {
    const match = String(artwork?.id || '').match(/^v41:(84532|11155111):([1-9]\d{0,77})$/);
    if (!match || artwork.moderation_hidden === true) return null;
    const [, chain, id] = match;
    const url = chain === '84532' ? `${ORIGIN}/artwork/${id}` : `${ORIGIN}/artwork?id=${encodeURIComponent(artwork.id)}`;
    const creator = text(artwork.creator_name, 80) ||
        (/^0x[a-f0-9]{40}$/i.test(artwork.creator || '') ? `${artwork.creator.slice(0,6)}…${artwork.creator.slice(-4)}` : 'Artist');
    const title = text(artwork.title, 120) || `Artwork #${id}`;
    const network = chain === '84532' ? 'Base Sepolia testnet' : 'Ethereum Sepolia testnet';
    let state = 'Digital artwork', priceLabel = '', price = '';
    const end = Date.parse(artwork.auction_end_time);
    if (artwork.status === 'for_sale' && artwork.minted) {
        state = 'NFT for sale'; priceLabel = 'Price'; price = amount(artwork.sale_price);
    } else if (artwork.minted) {
        state = 'Art NFT'; priceLabel = 'Floor'; price = amount(artwork.canonical_floor);
    } else if (artwork.status === 'auction' && Number.isFinite(end) && end > now) {
        state = 'Live art auction';
        price = amount(artwork.current_bid);
        priceLabel = price ? 'Current bid' : 'Starting price';
        price ||= amount(artwork.start_price);
    } else if (artwork.status === 'settlement_pending') {
        state = 'Artwork awaiting settlement';
    } else if (['auction', 'awaiting_end', 'defaulted'].includes(artwork.status)) {
        state = 'Artwork · auction ended';
    }
    const context = [state, price && `${priceLabel}: ${price} test ETH`, network].filter(Boolean).join(' · ');
    // Bound user-controlled text conservatively, including two-column characters.
    const draft = `“${text(title, 32)}” by ${text(creator, 20)}\n${context}\nArtSoul Protocol`;
    return {title, creator, url, context, draft, imageAlt:`${title} — ${creator}`};
}

export function artworkShareIntent(artwork) {
    const details = artworkShareDetails(artwork);
    if (!details) return '';
    return `https://x.com/intent/tweet?${new URLSearchParams({text:details.draft,url:details.url})}`;
}
