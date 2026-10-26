import { PROTOCOL_DOC_SECTIONS } from '../../content/protocol-docs.js';

export const SITE_SEARCH_CATEGORIES = ['pages', 'docs'];
const pages = [
    { id: 'home', title: 'ArtSoul Home', url: '/', text: 'Discover ArtSoul, protocol activity and featured digital art.' },
    { id: 'gallery', title: 'Art Gallery', url: '/gallery', text: 'Explore artwork, auctions, NFTs, the marketplace and collections.' },
    { id: 'publish', title: 'Publish Artwork', url: '/upload', text: 'Upload your art, review AI guidance and prepare an auction with your wallet.' },
    { id: 'profile', title: 'Your Profile', url: '/profile', text: 'Your artworks, auctions, collected NFTs, activity and private Saved list. Connect your wallet to view your own profile.' },
    { id: 'documentation', title: 'Protocol Docs', url: '/docs-protocol', text: 'Documentation and help: publishing, bidding, deposits, settlement, fees, wallets, Trust and copyright reports.' }
];
const docs = PROTOCOL_DOC_SECTIONS.map(section => ({ id: section.id, title: section.title, text: section.text, url: '/docs-protocol#' + section.id }));
export const getSiteSearchEntry = (kind, id) => (kind === 'pages' ? pages : kind === 'docs' ? docs : []).find(entry => entry.id === id);
const normalize = text => text.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/gu, ' ').trim();

// Only published, bundled content is indexed. No staff roster, inbox or private
// profile data enters this catalog, and no network access is needed to read it.
export function searchSiteContent(query, category = 'all') {
    const terms = normalize(query).split(' ').filter(Boolean);
    const limit = category === 'all' ? 5 : 20;
    return Object.fromEntries(Object.entries({ pages, docs }).map(([key, entries]) => {
        const matches = !terms.length || (category !== 'all' && category !== key) ? [] : entries
            .map(entry => {
                const title = normalize(entry.title), body = normalize(entry.text);
                const score = terms.every(term => (title + ' ' + body).includes(term))
                    ? terms.reduce((sum, term) => sum + (title.includes(term) ? 3 : 1), 0) : 0;
                const found = body.indexOf(terms[0]);
                const start = Math.max(0, found - 45);
                const excerpt = entry.text.replace(/\s+/gu, ' ').slice(start, start + 180);
                return { score, item: { id: entry.id, title: entry.title, url: entry.url,
                    excerpt: (start ? '…' : '') + excerpt + (start + 180 < body.length ? '…' : '') } };
            }).filter(entry => entry.score).sort((a, b) => b.score - a.score);
        return [key, { items: matches.slice(0, limit).map(entry => entry.item), hasMore: matches.length > limit }];
    }));
}
