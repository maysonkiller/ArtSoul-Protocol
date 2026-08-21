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

    function sized(url, width, quality = 70) {
        if (!url || typeof url !== 'string') return url;
        if (!Number.isInteger(width) || width < 16 || width > 2048) return url;
        // Production rows carry a bare 'image' in file_type rather than a MIME
        // type, so the extension is the honest signal; anything unrecognised,
        // including an extensionless upload that could be a GIF, is left alone.
        if (!RESAMPLEABLE_STILL.test(url)) return url;
        if (!url.includes(OBJECT_PATH)) return url;
        if (!isValidStorageUrl(url)) return url;
        try {
            const rendered = new URL(url.replace(OBJECT_PATH, RENDER_PATH));
            rendered.searchParams.set('width', String(width));
            rendered.searchParams.set('quality', String(quality));
            return rendered.toString();
        } catch {
            return url;
        }
    }

    window.ArtSoulStorageImage = Object.freeze({ sized, isValidStorageUrl });
})();
