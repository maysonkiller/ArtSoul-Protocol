import { getModerationAccess, readAuthorityPolicy } from './moderation-access.js';
import { getWebAuthnConfig, roleBoundSessionsEnabled, readModerationSession } from './moderation-passkey.js';
import { requireProtocolAdminEnabled } from './protocol-admin-config.js';
import { serviceError } from './launch-services.js';

export async function verifiedReviewActor(req, { frameWrite = false } = {}) {
    requireProtocolAdminEnabled();
    const access = await getModerationAccess(req, { strict: true });
    const session = roleBoundSessionsEnabled() && readModerationSession(req);
    const denied = () => serviceError('REVIEWER_REQUIRED','Verify an authorized staff wallet to continue.',403);
    if (!session?.authorizationVersion || !access?.stepUpActive || !['admin','team'].includes(access.role) ||
        (frameWrite && access.role !== 'team') ||
        session.wallet !== access.wallet || session.wallet !== req.query?.wallet) throw denied();
    const origin = getWebAuthnConfig().origin;
    const policy = access.role === 'team' ? await readAuthorityPolicy(origin) : null;
    if (access.role === 'team' && !policy?.authorities?.includes(session.wallet)) throw denied();
    return {origin, params:{p_actor:session.wallet,p_version:session.authorizationVersion,
        p_origin:policy?.origin ?? null,p_policy_version:policy?.version ?? null}};
}
