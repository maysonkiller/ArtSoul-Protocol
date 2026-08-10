// Public artwork URLs.
//
// The canonical identifier stays the composite `v41:<chain>:<artworkId>` that
// the projection uses. Only the URL is shortened, and only on the product
// chain, where the chain segment carries no information for a reader. Legacy
// Ethereum Sepolia rows keep the explicit composite so a bare number is never
// ambiguous.

export const CANONICAL_ARTWORK_CHAIN_ID = 84532;

const COMPOSITE_PATTERN = /^v41:(\d+):(\d{1,78})$/i;
const BARE_ID_PATTERN = /^\d{1,78}$/;

/** Public path for an artwork, short where that is unambiguous. */
export function artworkPath(rawId) {
    const id = String(rawId ?? '').trim();
    if (!id) return '';

    const composite = id.match(COMPOSITE_PATTERN);
    if (composite && Number(composite[1]) === CANONICAL_ARTWORK_CHAIN_ID) {
        return `/artwork/${composite[2]}`;
    }

    return `/artwork?id=${encodeURIComponent(id)}`;
}

/** Restore the composite identifier from whatever the URL carried. */
export function expandArtworkId(rawId) {
    const id = String(rawId ?? '').trim();
    if (BARE_ID_PATTERN.test(id)) {
        return `v41:${CANONICAL_ARTWORK_CHAIN_ID}:${id}`;
    }
    return id;
}

// artwork-card.js is loaded as a classic script and cannot import, so the same
// implementation is published globally rather than duplicated there.
if (typeof window !== 'undefined') {
    window.ArtSoulArtworkUrl = { artworkPath, expandArtworkId, CANONICAL_ARTWORK_CHAIN_ID };
}
