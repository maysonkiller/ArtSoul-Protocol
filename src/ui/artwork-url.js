// Public artwork URLs — the single owner of both directions.
//
// The canonical identifier stays the composite `v41:<chain>:<artworkId>` that
// the projection uses. Only the address is shortened, and only on the product
// chain, where the chain segment tells a reader nothing. Legacy Ethereum
// Sepolia rows keep the explicit composite so a bare number is never ambiguous.
//
// This is a classic script, not a module, and it is loaded in <head> before
// artwork-card.js. Card markup is built during classic-script execution, which
// runs before deferred module scripts, so a module here would not be ready in
// time and links would disagree between surfaces.

(function () {
    'use strict';

    const CANONICAL_ARTWORK_CHAIN_ID = 84532;
    const COMPOSITE_PATTERN = /^v41:(\d+):(\d{1,78})$/i;
    const BARE_ID_PATTERN = /^\d{1,78}$/;
    const SHORT_PATH_PATTERN = /^\/artwork\/([^/?#]+)\/?$/;

    /** Public path for an artwork, short where that is unambiguous. */
    function artworkPath(rawId) {
        const id = String(rawId == null ? '' : rawId).trim();
        if (!id) return '';

        const composite = id.match(COMPOSITE_PATTERN);
        if (composite && Number(composite[1]) === CANONICAL_ARTWORK_CHAIN_ID) {
            return '/artwork/' + composite[2];
        }

        return '/artwork?id=' + encodeURIComponent(id);
    }

    /** Restore the composite identifier from whatever the URL carried. */
    function expandArtworkId(rawId) {
        const id = String(rawId == null ? '' : rawId).trim();
        return BARE_ID_PATTERN.test(id) ? 'v41:' + CANONICAL_ARTWORK_CHAIN_ID + ':' + id : id;
    }

    /**
     * The artwork this document is showing.
     *
     * /artwork/<id> is served by a server-side rewrite, so the browser URL keeps
     * the path and carries no query string at all. Reading only location.search
     * therefore finds nothing on exactly the URLs the product now links to.
     */
    function currentArtworkId(location) {
        const target = location || (typeof window !== 'undefined' ? window.location : null);
        if (!target) return '';

        const shortPath = String(target.pathname || '').match(SHORT_PATH_PATTERN);
        if (shortPath) {
            let segment = shortPath[1];
            try {
                segment = decodeURIComponent(segment);
            } catch (error) {
                // A malformed escape stays as written; validation happens downstream.
            }
            return expandArtworkId(segment);
        }

        const search = new URLSearchParams(String(target.search || ''));
        return expandArtworkId(search.get('id'));
    }

    const api = { artworkPath, expandArtworkId, currentArtworkId, CANONICAL_ARTWORK_CHAIN_ID };

    if (typeof window !== 'undefined') window.ArtSoulArtworkUrl = api;
})();
