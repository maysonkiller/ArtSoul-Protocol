// Guidance values are untrusted model/metadata output, never protocol prices.
// Reject malformed values rather than silently inventing a corrected estimate.
export function parseAIPrice(value) {
    if (typeof value === 'string') {
        const text = value.trim();
        if (!/^\d+(?:[.,]\d+)?$/.test(text)) return null;
        value = Number(text.replace(',', '.'));
    }
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000000
        ? value : null;
}

export function readAIValuation(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const min = parseAIPrice(value.estimated_value_min_eth);
    const max = parseAIPrice(value.estimated_value_max_eth);
    const start = parseAIPrice(value.suggested_start_price_eth);
    if (min === null || max === null || start === null || min > max) return null;
    return {
        ...value,
        estimated_value_min_eth: min,
        estimated_value_max_eth: max,
        suggested_start_price_eth: start
    };
}

export function formatAIPrice(value, locale) {
    const price = parseAIPrice(value);
    return price === null ? 'Unavailable' : price.toLocaleString(locale, {
        useGrouping: false,
        maximumSignificantDigits: 6
    });
}
