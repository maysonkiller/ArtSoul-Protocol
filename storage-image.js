/**
 * One place that knows how to ask our storage for a smaller copy of an image.
 *
 * It used to live in supabase-client.js, which is a module reached only through
 * the page bundle. avatar-dropdown.js is a classic deferred script and paints
 * the account button long before that bundle executes - measured on a phone,
 * roughly 0.5s against 3.3s - so it called a helper that did not exist yet and
 * silently fell back to the upload itself. The account button then pulled a
 * 2.37 MB picture for a 40px circle, and the guest avatar stayed on screen
 * until it finished. That is why the button looked wrong long after the name
 * and address were already correct.
 *
 * So this is a plain script with no imports, loaded before every consumer.
 *
 * Presentation only: the original URL is what stays stored, projected and
 * linked. This returns a display copy and never replaces the source of truth.
 */
(function () {
    'use strict';

    const ALLOWED_STORAGE_DOMAIN = 'bexigvqrunomwtjsxlej.supabase.co';
    const OBJECT_PATH = '/storage/v1/object/public/';
    const RENDER_PATH = '/storage/v1/render/image/public/';

    // Raster stills the render endpoint can safely resample. GIF is absent on
    // purpose: a still transform would drop its animation. SVG is absent
    // because it is already small and rasterising it loses the point.
    const RESAMPLEABLE_STILL = /\.(jpg|jpeg|png|webp|avif)(\?|$)/i;

    function isValidStorageUrl(url) {
        if (!url || typeof url !== 'string') return false;
        try {
            return new URL(url).hostname === ALLOWED_STORAGE_DOMAIN;
        } catch {
            return false;
        }
    }

    // Both dimensions, always.
    //
    // The render endpoint does not scale proportionally when it is given only a
    // width: it returns that width against the ORIGINAL height. Verified in a
    // browser against a 1254x1254 avatar - `?width=128` came back 128x1254 and
    // `?width=600` came back 600x1254. Every sized image was therefore a narrow
    // sliver, which `object-fit: cover` then blew up about tenfold. That is the
    // avatar that looked stretched and enormously zoomed, and the card media
    // that looked wrong beside it.
    //
    // Every place we size is a square box - the account button circle, the card
    // media with `aspect-ratio: 1` - so one number is asked for and sent as both
    // dimensions. `cover` is the endpoint's own default for a width and height
    // pair and matches the `object-fit: cover` the box already uses, so the
    // crop the browser would have made is simply made earlier.
    function sized(url, size, quality = 70) {
        if (!url || typeof url !== 'string') return url;
        if (!Number.isInteger(size) || size < 16 || size > 2048) return url;
        // Production rows carry a bare 'image' in file_type rather than a MIME
        // type, so the extension is the honest signal; anything unrecognised,
        // including an extensionless upload that could be a GIF, is left alone.
        if (!RESAMPLEABLE_STILL.test(url)) return url;
        if (!url.includes(OBJECT_PATH)) return url;
        if (!isValidStorageUrl(url)) return url;
        try {
            const rendered = new URL(url.replace(OBJECT_PATH, RENDER_PATH));
            rendered.searchParams.set('width', String(size));
            rendered.searchParams.set('height', String(size));
            rendered.searchParams.set('resize', 'cover');
            rendered.searchParams.set('quality', String(quality));
            return rendered.toString();
        } catch {
            return url;
        }
    }

    window.ArtSoulStorageImage = Object.freeze({ sized, isValidStorageUrl });
})();
