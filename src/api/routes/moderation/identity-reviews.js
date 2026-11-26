import { allowMethods, sendError } from '../../backend.js';
import { reviewBody, reviewRpc } from '../../identity-applications.js';
import { requireService, serviceError } from '../../launch-services.js';
import { verifiedReviewActor } from '../../frame-source-access.js';

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (!allowMethods(req, res, ['GET','POST'])) return;
    try {
        requireService('ARTSOUL_PROFILE_IDENTITY_REVIEWS_ENABLED');
        const actor = await verifiedReviewActor(req);
        const params = { ...actor.params, p_action:null, p_note:null, p_id:null, p_status:null, p_after:null };
        if (req.method === 'POST') {
            const body = await reviewBody(req, 'action,id,note', actor.origin);
            if (typeof body.id !== 'string' || !/^[1-9]\d{0,17}$/.test(body.id) || !['approve','decline','revoke'].includes(body.action) ||
                typeof body.note !== 'string' || body.note.trim().length < 5 || body.note.trim().length > 500) {
                throw serviceError('INVALID_DECISION','Choose a request and enter a reason between 5 and 500 characters.');
            }
            Object.assign(params,{ p_id:body.id, p_action:body.action, p_note:body.note.trim() });
            const decision = await reviewRpc('manage_identity_reviews', params);
            if (decision?.action !== body.action || decision?.id !== body.id) throw serviceError('REVIEW_UNCONFIRMED','Reload the queue to confirm the decision.',503);
            return res.status(200).json(decision);
        }
        params.p_status = req.query?.status ?? 'pending';
        params.p_after = req.query?.after ?? '0';
        if (!['pending','approved','declined','revoked'].includes(params.p_status) || typeof params.p_after !== 'string' ||
            !/^(0|[1-9]\d{0,17})$/.test(params.p_after)) throw serviceError('INVALID_QUERY','Choose a valid queue page.');
        const rows = await reviewRpc('manage_identity_reviews',params);
        if (!Array.isArray(rows) || rows.length > 26) throw serviceError('REVIEW_UNAVAILABLE','Reload the review queue.',503);
        return res.status(200).json({ applications: rows.slice(0,25), next: rows.length > 25 ? rows[24].id : null });
    } catch (error) { return sendError(res,error); }
}
