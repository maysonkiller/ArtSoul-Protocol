// Prepare a complete bitmap before replacing a visible image. Callers own the
// cancellation token so an old address or artwork cannot win a later render.
export function decodeImage(source, createImage = () => new Image()) {
    return new Promise((resolve, reject) => {
        const image = createImage();
        image.decoding = 'async';
        image.onload = async () => {
            try {
                if (typeof image.decode === 'function') await image.decode();
                resolve(source);
            } catch (error) {
                reject(error);
            } finally {
                image.onload = image.onerror = null;
            }
        };
        image.onerror = () => {
            image.onload = image.onerror = null;
            reject(new Error('Image could not be loaded'));
        };
        image.src = source;
    });
}

// The saved URL stays original. Reuse one display size across profile and
// provenance so their visits share the browser cache without reframing portraits.
export async function decodeAvatar(source, createImage, resize = globalThis.window?.ArtSoulStorageImage?.contained) {
    const display = resize?.(source, 384) || source;
    try {
        return await decodeImage(display, createImage);
    } catch (error) {
        if (display === source) throw error;
        return decodeImage(source, createImage);
    }
}

// Reuse prepared public avatars for repeated roles and remounts. Upload URLs
// identify immutable files; a changed URL gets its own preparation. Keep this
// bounded and in memory, with failures evicted so a later visit can retry.
const preparedAvatars = new Map();
const PREPARED_AVATAR_LIMIT = 64;

export function readPreparedAvatar(source) {
    return preparedAvatars.get(source)?.url || '';
}

export function prepareAvatar(source) {
    const cached = preparedAvatars.get(source);
    if (cached) return cached.promise;
    if (preparedAvatars.size >= PREPARED_AVATAR_LIMIT) {
        preparedAvatars.delete(preparedAvatars.keys().next().value);
    }
    const entry = { url: '', promise: null };
    entry.promise = decodeAvatar(source).then(url => {
        entry.url = url;
        return url;
    }, error => {
        if (preparedAvatars.get(source) === entry) preparedAvatars.delete(source);
        throw error;
    });
    preparedAvatars.set(source, entry);
    return entry.promise;
}
