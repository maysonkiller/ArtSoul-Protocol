import { useEffect, useState } from 'react';

// A filtered-out auction has no card countdown of its own. Reclassify the
// loaded list at its next deadline without requesting the same records again.
export function useAuctionExpiry(artworks) {
    const [asOf, setAsOf] = useState(Date.now);
    useEffect(() => scheduleAuctionExpiry(artworks, asOf, setAsOf), [artworks, asOf]);
    return asOf;
}

export function scheduleAuctionExpiry(artworks, asOf, refresh) {
    let nextEnd = Infinity;
    for (const artwork of artworks || []) {
        const status = artwork.status || artwork.auction_state || artwork.lifecycle_state;
        if (status !== 'auction') continue;
        const end = window.ArtSoulArtworkCard?.auctionEndTimestamp?.(artwork);
        if (end > asOf && end < nextEnd) nextEnd = end;
    }
    if (!Number.isFinite(nextEnd)) return;
    const delay = Math.min(2_147_483_647, Math.max(0, nextEnd - Date.now()));
    const timer = window.setTimeout(() => refresh(Date.now()), delay);
    return () => window.clearTimeout(timer);
}
