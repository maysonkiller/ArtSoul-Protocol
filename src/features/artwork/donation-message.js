// A byte resource limit and a display character limit are different rules.
export const DONATION_MESSAGE_BYTES = 560;
export const DONATION_MESSAGE_CHARACTERS = 140;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function donationMessageState(message) {
    if (typeof message !== 'string' || message.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(message)) {
        return { valid: false, characters: 0, bytes: 0 };
    }
    const bytes = new TextEncoder().encode(message).length;
    if (bytes > DONATION_MESSAGE_BYTES) return { valid: false, characters: null, bytes };
    const characters = Array.from(segmenter.segment(message)).length;
    return { valid: characters <= DONATION_MESSAGE_CHARACTERS, characters, bytes };
}

export function visibleDonationMessage(message, hidden = false) {
    return !hidden && donationMessageState(message).valid ? message : null;
}
