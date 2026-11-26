import { allowMethods, requireWallet, sendError } from '../backend.js';
import { requireService, serviceError } from '../launch-services.js';
import { applicationParams, reviewBody, reviewRpc } from '../identity-applications.js';

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (!allowMethods(req, res, ['GET','POST'])) return;
    try {
        requireService('ARTSOUL_PROFILE_IDENTITY_REVIEWS_ENABLED');
        const wallet = requireWallet(req);
        if (req.headers['x-artsoul-wallet'] !== wallet) throw serviceError('WALLET_CHANGED', 'Sign in with the selected profile wallet.', 401);
        if (req.method === 'GET') return res.status(200).json({ applications: await reviewRpc('identity_applicant_status', { p_wallet: wallet }) });
        const body = await reviewBody(req, 'chain,collection,evidence');
        const id = await reviewRpc('request_identity_review', { p_wallet: wallet, ...applicationParams(body) });
        if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) throw serviceError('REVIEW_UNCONFIRMED','Reload your requests to confirm submission.',503);
        return res.status(200).json({ id });
    } catch (error) { return sendError(res, error); }
}
