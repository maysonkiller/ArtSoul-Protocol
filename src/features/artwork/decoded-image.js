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
