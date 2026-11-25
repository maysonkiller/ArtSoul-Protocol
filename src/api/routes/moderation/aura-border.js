import { allowMethods, sendError, supabaseRest } from '../../backend.js';
import { readBoundedJson } from '../../launch-services.js';
import { getModerationAccess } from '../../moderation-access.js';
import { getWebAuthnConfig, readModerationSession, roleBoundSessionsEnabled } from '../../moderation-passkey.js';
import { requireProtocolAdminEnabled } from '../../protocol-admin-config.js';
import { readAuraBorderSetting, validateAuraSetting } from '../../aura-border-setting.js';

function fail(statusCode, code, message) {
    return Object.assign(new Error(message), { statusCode, code });
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (!allowMethods(req, res, ['GET', 'PUT'])) return;
    try {
        requireProtocolAdminEnabled();
        const access = await getModerationAccess(req, { strict: true });
        const session = roleBoundSessionsEnabled() && readModerationSession(req);
        if (access.role !== 'admin' || !access.stepUpActive || !session?.authorizationVersion ||
            access.wallet !== session.wallet || access.wallet !== req.query?.wallet) {
            throw fail(403, 'AURA_ADMIN_REQUIRED', 'Verify your administrator wallet to manage NFT appearance.');
        }
        if (req.method === 'GET') return res.status(200).json(await readAuraBorderSetting());
        if (req.headers.origin !== getWebAuthnConfig().origin || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
            throw fail(403, 'INVALID_AURA_REQUEST', 'Open the ArtSoul admin panel to change NFT appearance.');
        }
        const data = await readBoundedJson(req, 1024);
        if (Object.keys(data || {}).sort().join(',') !== 'enabled,revision' || typeof data.enabled !== 'boolean' ||
            !Number.isInteger(data.revision) || data.revision < 0 || data.revision > 2147483647) {
            throw fail(400, 'INVALID_AURA_SETTING', 'Reload the current appearance setting.');
        }
        const rows = await supabaseRest('rpc/set_aura_border_setting', { method: 'POST', body: {
            p_wallet: session.wallet, p_authorization_version: session.authorizationVersion,
            p_enabled: data.enabled, p_expected_revision: data.revision
        } });
        const saved = validateAuraSetting(rows);
        if (saved.enabled !== data.enabled || (saved.revision !== data.revision && saved.revision !== data.revision + 1)) {
            throw fail(503, 'AURA_SETTING_UNCONFIRMED', 'Reload the current appearance setting to verify the change.');
        }
        return res.status(200).json(saved);
    } catch (error) {
        const detail = String(error?.details?.message || error.message || '');
        if (detail.includes('AURA_REVISION_CONFLICT')) error = fail(409, 'AURA_REVISION_CONFLICT', 'The setting changed. Reload it before saving.');
        if (detail.includes('AURA_ADMIN_REQUIRED')) error = fail(403, 'AURA_ADMIN_REQUIRED', 'Verify your administrator wallet to manage NFT appearance.');
        return sendError(res, error);
    }
}
