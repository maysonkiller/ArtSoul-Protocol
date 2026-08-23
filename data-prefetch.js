/**
 * Start this page's own data request before the bundle exists.
 *
 * Measured on the apex with an iPhone viewport and a 6x CPU slowdown, which is
 * roughly a mid-range phone: the document is interactive at 674 ms, but the
 * modules only finish executing at 3276 ms, and the request for the page's
 * content is not issued until 3410 ms - because it waits for them. 136 script
 * files, 504 KB. The screen is blank for 2.7 seconds before even a skeleton,
 * and the first real content lands at 5.8 s.
 *
 * The network is idle for all of that. This file is a few hundred bytes of
 * classic script in <head>: it builds the exact request the page will make and
 * issues it now, so the fetch overlaps the module work instead of queueing
 * behind it.
 *
 * It is a head start, never a cache. Each response is handed to exactly one
 * consumer and then forgotten, so nothing here can serve stale data. If the
 * page asks for something else, or asks twice, or this file is absent, the
 * normal request happens exactly as before.
 */
(function () {
    'use strict';

    var WALLET = /^0x[a-fA-F0-9]{40}$/;
    var store = new Map();

    // Addresses reach us in whatever case they were written - the URL carries
    // the checksummed form, the database row is lower case - and the two name
    // the same account. The key is folded so a head start is not thrown away
    // over capitalisation. Every other value here is already lower case or a
    // number.
    function key(path) {
        return String(path || '').toLowerCase();
    }

    window.ArtSoulPrefetch = {
        take: function (path) {
            var k = key(path);
            var pending = store.get(k);
            if (!pending) return null;
            store.delete(k);
            return pending;
        }
    };

    function start(path) {
        try {
            var pending = fetch(path, { method: 'GET', credentials: 'include' });
            // An unconsumed rejection must not reach the console: the page will
            // make its own request and report the failure itself.
            pending.catch(function () {});
            store.set(key(path), pending);
        } catch (error) {
            // No head start. The page still works.
        }
    }

    function read(name) {
        try {
            return localStorage.getItem(name);
        } catch (error) {
            return null;
        }
    }

    function profileWallet() {
        var viewing = '';
        try {
            viewing = new URLSearchParams(window.location.search).get('address') || '';
        } catch (error) {
            viewing = '';
        }
        if (WALLET.test(viewing)) return viewing;
        // Your own profile carries no address. The header cache already knows
        // which wallet this browser last had, and is the same source the first
        // paint trusts.
        var own = read('artsoul_wallet') || '';
        return WALLET.test(own) ? own : '';
    }

    function artworkId(path) {
        var cleanPrefix = '/artwork/';
        if (path.indexOf(cleanPrefix) === 0) {
            try {
                return decodeURIComponent(path.slice(cleanPrefix.length));
            } catch (error) {
                return '';
            }
        }

        if (path !== '/artwork') return '';
        try {
            return new URLSearchParams(window.location.search).get('id') || '';
        } catch (error) {
            return '';
        }
    }

    var path = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';

    // Every page needs the public config before it can talk to storage.
    start('/api/public/config');

    if (path === '/profile') {
        var wallet = profileWallet();
        // Mirrors the default gallery in profile.jsx: created works, limit 200,
        // in that parameter order, because the key is the request string.
        if (wallet) start('/api/public/artworks?creator=' + wallet + '&limit=200');
    } else if (path === '/artwork' || path.indexOf('/artwork/') === 0) {
        var id = artworkId(path);
        // Mirrors getPublicProjectionArtwork(): id first, then limit. Starting
        // this from the head overlaps the exact-artwork server cold path with
        // the page bundle instead of waiting for the bundle before dialing it.
        if (id) start('/api/public/artworks?id=' + encodeURIComponent(id) + '&limit=1');
    } else if (path === '/') {
        start('/api/public/artworks?limit=100');
    }
})();
