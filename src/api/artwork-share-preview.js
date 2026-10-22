import publicArtworks from './routes/public/artworks.js';
import { allowedArtworkUrl } from './safe-artwork-fetch.js';
import { artworkShareDetails } from '../features/artwork/artwork-sharing.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const ORIGIN = 'https://artsoulprotocol.com';

export function renderArtworkPreview(artwork) {
    const details = artworkShareDetails(artwork);
    if (!details) return null;
    const image = allowedArtworkUrl(artwork.image || artwork.poster_url ||
        (['image','gif'].includes(artwork.media_type) ? artwork.media_url : ''))?.href;
    // A non-visual work without a poster cannot acquire a fabricated artwork image.
    const previewImage = image || `${ORIGIN}/default-avatar.png`;
    const title = `${details.title} — ${details.creator}`;
    const description = details.context + ' · ArtSoul Protocol';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title><link rel="canonical" href="${escape(details.url)}">
<meta name="description" content="${escape(description)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="ArtSoul">
<meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}">
<meta property="og:url" content="${escape(details.url)}"><meta property="og:image" content="${escape(previewImage)}">
<meta property="og:image:alt" content="${escape(image ? details.imageAlt : 'ArtSoul')}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}">
<meta name="twitter:image" content="${escape(previewImage)}"><meta name="twitter:image:alt" content="${escape(image ? details.imageAlt : 'ArtSoul')}">
</head><body><main><h1>${escape(title)}</h1><p>${escape(description)}</p>
<img src="${escape(previewImage)}" alt="${escape(image ? details.imageAlt : 'ArtSoul')}" width="600">
<p><a href="${escape(details.url)}">Open artwork on ArtSoul</a></p></main></body></html>`;
}

export function createArtworkPreviewHandler(readPublicArtwork = publicArtworks) {
    return async (req, res) => {
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Vary', 'User-Agent');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; img-src https:; base-uri 'none'; frame-ancestors 'none'");
        if (!['GET','HEAD'].includes(req.method)) {
            res.setHeader('Allow', 'GET, HEAD');
            return res.status(405).end();
        }
        const id = typeof req.query?.id === 'string' ? req.query.id : '';
        if (!/^(?:v41:(?:84532|11155111):)?[1-9]\d{0,77}$/.test(id)) return res.status(404).end();
        let status = 500, body;
        // Always use the guest projection. A caller's staff cookie or action
        // query must never reveal hidden work to a social crawler.
        await readPublicArtwork({method:'GET',query:{id},headers:{}}, {
            setHeader() {}, status(value) { status=value; return this; },
            json(value) { body=value; return this; }
        });
        if (status !== 200 || body?.success !== true) return res.status(503).end();
        const expectedId = id.startsWith('v41:') ? id : `v41:84532:${id}`;
        const artwork = body.data?.find(item => item.id === expectedId && item.moderation_hidden !== true);
        const html = artwork && renderArtworkPreview(artwork);
        if (!html) return res.status(404).end();
        return res.status(200).end(req.method === 'HEAD' ? '' : html);
    };
}
