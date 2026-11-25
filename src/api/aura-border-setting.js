import { supabaseRest } from './backend.js';

export function validateAuraSetting(rows) {
    const [row] = Array.isArray(rows) ? rows : [];
    if (rows?.length !== 1 || typeof row?.enabled !== 'boolean' ||
        !Number.isInteger(row.revision) || row.revision < 0) throw new Error('Invalid aura setting response.');
    return { enabled: row.enabled, revision: row.revision };
}

export async function readAuraBorderSetting() {
    return validateAuraSetting(await supabaseRest('rpc/read_aura_border_setting', { signal: AbortSignal.timeout(1800) }));
}
