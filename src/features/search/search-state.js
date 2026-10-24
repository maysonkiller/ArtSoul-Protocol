export const SEARCH_CATEGORIES = ['all', 'artworks', 'auctions', 'artists'];
export const normalizeSearchQuery = value => String(value || '').trim().replace(/\s+/gu, ' ');
export function canSearch(value) {
    const query = normalizeSearchQuery(value);
    const length = [...query].length;
    return length <= 100 && !/[\u0000-\u001f\u007f]/u.test(query) && (length >= 2 || /^[1-9]$/.test(query));
}
const emptyGroups = () => Object.fromEntries(SEARCH_CATEGORIES.slice(1).map(key => [key, { items: [], hasMore: false }]));

// Each request belongs to one query/category generation. A late success or
// failure cannot repaint a newer search or a closed dialog, even without abort.
export function createSearchState({ request = fetch, onChange = () => {} } = {}) {
    let sequence = 0, controller;
    let state = { query: '', category: 'all', status: 'idle', groups: emptyGroups(), nextCursor: null, error: '' };
    const publish = patch => { state = { ...state, ...patch }; onChange(state); };
    function cancel() { sequence++; controller?.abort(); controller = null; }
    function reset(query = '', category = 'all') {
        cancel(); publish({ query: normalizeSearchQuery(query), category, status: 'idle', groups: emptyGroups(), nextCursor: null, error: '' });
    }
    async function search(query, category = 'all', append = false) {
        query = normalizeSearchQuery(query);
        if (!SEARCH_CATEGORIES.includes(category) || !canSearch(query)) { reset(query); return; }
        if (append && (state.status !== 'ready' || !state.nextCursor || state.query !== query || state.category !== category)) return;
        const before = append ? state.nextCursor : null;
        cancel(); const current = sequence; controller = new AbortController();
        const activeController = controller, signal = activeController.signal;
        publish({ query, category, status: append ? 'more' : 'loading', error: '', ...(append ? {} : { groups: emptyGroups(), nextCursor: null }) });
        let timedOut = false;
        const timeout = setTimeout(() => { timedOut = true; activeController.abort(); }, 20000);
        try {
            const params = new URLSearchParams({ q: query, category });
            if (before) params.set('cursor', before);
            const response = await request('/api/public/search?' + params, { signal, credentials: 'omit', cache: 'no-store' });
            if (!response.ok) throw new Error(response.status === 503 ? 'Search is temporarily unavailable. Please try again.' : 'Search could not be completed. Please try again.');
            const body = await response.json();
            if (current !== sequence) return;
            if (body.query !== query || body.category !== category || !body.groups ||
                (body.nextCursor !== null && typeof body.nextCursor !== 'string') ||
                (before && before === body.nextCursor)) throw new Error('Search returned an invalid response. Please try again.');
            const groups = emptyGroups();
            for (const key of SEARCH_CATEGORIES.slice(1)) {
                const group = body.groups[key];
                if (!Array.isArray(group?.items) || group.items.some(item => !item || typeof item !== 'object') ||
                    group.items.length > (category === 'all' ? 5 : 20) || typeof group.hasMore !== 'boolean') throw new Error('Search returned an invalid response. Please try again.');
                const old = append ? state.groups[key].items : [];
                const identity = item => key === 'artists' ? item?.wallet_address : `${item?.chain_id}:${item?.artwork_id || item?.blockchain_id}`;
                const items = new Map(old.map(item => [identity(item), item]));
                for (const item of group.items) items.set(identity(item), item);
                groups[key] = { items: [...items.values()], hasMore: group.hasMore };
            }
            publish({ groups, nextCursor: body.nextCursor, status: 'ready', error: '' });
        } catch (error) {
            if (current === sequence) publish({ status: 'error', error: timedOut ? 'Search took too long. Please try again.' :
                (error instanceof TypeError ? 'Check your connection and try again.' : error.message || 'Search could not be completed.') });
        } finally { clearTimeout(timeout); }
    }
    return { getState: () => state, reset, cancel, search };
}

export function readSearchHistory(storage) {
    try {
        const value = JSON.parse(storage?.getItem('artsoul_search_history') || '{}');
        return {
            queries: (Array.isArray(value.queries) ? value.queries : []).filter(q => typeof q === 'string' && canSearch(q)).slice(0, 6),
            views: (Array.isArray(value.views) ? value.views : []).filter(v => v && typeof v.id === 'string' &&
                ((v.kind === 'artwork' && /^[1-9][0-9]{0,77}$/.test(v.id)) || (v.kind === 'artist' && /^0x[0-9a-f]{40}$/.test(v.id)))).slice(0, 6)
        };
    } catch { return { queries: [], views: [] }; }
}
export function writeSearchHistory(storage, history) {
    try { storage?.setItem('artsoul_search_history', JSON.stringify(history)); } catch { /* Browsing works without storage. */ }
}
