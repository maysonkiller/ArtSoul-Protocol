export const DEFAULT_HEALTH_MAX_BLOCKS_BEHIND = 20;

export function resolveHealthMaxBlocksBehind(
    value,
    fallback = DEFAULT_HEALTH_MAX_BLOCKS_BEHIND
) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error('INDEXER_HEALTH_MAX_BLOCKS_BEHIND must be a positive integer');
    }

    return parsed;
}

export function parseHealthCount(value) {
    const count = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    return Number.isSafeInteger(count) && count >= 0 ? count : NaN;
}

export function isIndexerWithinHealthLag(blocksBehind, maxBlocksBehind) {
    return parseHealthCount(blocksBehind) < maxBlocksBehind;
}
