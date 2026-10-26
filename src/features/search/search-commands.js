import { SEARCH_CATEGORIES, canSearch, normalizeSearchQuery, createSearchState } from './search-state.js';

const validId = value => typeof value === 'string' && /^[1-9][0-9]{0,77}$/.test(value) && BigInt(value) < 2n ** 256n;
const text = value => typeof value === 'string' ? value : '';

// Reuse global search validation, visibility and credential-free transport. An
// invocation has its own state so it cannot cancel the person's open search.
export async function searchCatalog(input, { request } = {}) {
    if (!input || Array.isArray(input) || typeof input !== 'object' ||
        Object.keys(input).some(key => !['query', 'category'].includes(key)) || typeof input.query !== 'string') {
        return { error: 'Provide a search query and an optional category: all, artworks, auctions or artists.' };
    }
    const query = normalizeSearchQuery(input.query), category = input.category ?? 'all';
    if (!canSearch(query) || !SEARCH_CATEGORIES.includes(category)) {
        return { error: 'Enter 2–100 characters, or a positive artwork number, and a valid search category.' };
    }
    const state = createSearchState({ request });
    await state.search(query, category);
    const result = state.getState();
    if (result.status !== 'ready') return { error: result.error || 'Search could not be completed. Please try again.' };
    const groups = {};
    for (const key of SEARCH_CATEGORIES.slice(1)) {
        const source = result.groups[key];
        const items = [];
        for (const item of source.items) {
            if (key === 'artists') {
                const address = text(item.wallet_address).toLowerCase();
                if (!/^0x[0-9a-f]{40}$/.test(address)) return { error: 'Search returned an invalid profile. Please try again.' };
                items.push({ wallet_address: address, name: text(item.username) || address,
                    url: '/profile?address=' + address });
            } else {
                const id = item.artwork_id || item.blockchain_id;
                if (!validId(id) || Number(item.chain_id) !== 84532) return { error: 'Search returned an invalid artwork. Please try again.' };
                items.push({ artwork_id: id, title: text(item.title) || `Artwork #${id}`,
                    creator: text(item.creator_name) || text(item.creator), url: '/artwork/' + id });
            }
        }
        groups[key] = { items, hasMore: source.hasMore };
    }
    return { query, category, chain: 'Base Sepolia', groups,
        note: 'These are the matches shown, not total counts. Artwork and auction groups can overlap. Use Search ArtSoul for more results.' };
}
