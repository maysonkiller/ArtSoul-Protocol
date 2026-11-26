import { normalizeWallet, supabaseRest } from './backend.js';
import { publicOrigin, readBoundedJson, serviceError } from './launch-services.js';

const errors = {
    PROFILE_NAME_REQUIRED: [409, 'Save a public profile name before requesting verification.'],
    ALREADY_VERIFIED: [409, 'This identity already has an active verification.'],
    APPLICATION_LIMIT: [429, 'You can submit five requests in 24 hours. Try again later.'],
    REVIEWER_REQUIRED: [403, 'Verify an authorized staff wallet to review requests.'],
    SEPARATE_REVIEWER_REQUIRED: [403, 'A different authorized wallet must review this request.'],
    PROFILE_CHANGED: [409, 'The profile changed. Decline this request and ask for a new one.'],
    APPLICATION_CHANGED: [409, 'This request has changed. Reload the queue.']
};

export async function reviewRpc(name, body) {
    try { return await supabaseRest('rpc/' + name, { method: 'POST', body }); }
    catch (error) {
        const code = error?.details?.message;
        if (Object.hasOwn(errors, code)) throw serviceError(code, errors[code][1], errors[code][0]);
        throw serviceError('REVIEW_UNAVAILABLE', 'Verification is temporarily unavailable.', 503);
    }
}

export async function reviewBody(req, keys, origin = publicOrigin()) {
    if (req.headers.origin !== origin) throw serviceError('INVALID_ORIGIN', 'Open ArtSoul to submit this request.', 403);
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw serviceError('JSON_REQUIRED', 'Use a JSON request.', 415);
    const body = await readBoundedJson(req, 4096);
    if (Object.keys(body).sort().join(',') !== keys) throw serviceError('INVALID_REQUEST', 'Check the request fields.');
    return body;
}

export function applicationParams(body) {
    let url;
    try { url = new URL(body.evidence); } catch {}
    if (typeof body.evidence !== 'string' || !url || url.protocol !== 'https:' || url.username || url.password ||
        !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/i.test(url.hostname) ||
        url.href.length > 512) throw serviceError('INVALID_EVIDENCE', 'Enter a public HTTPS link showing the creator and wallet.');
    const profile = body.chain === null && body.collection === null;
    const collection = typeof body.collection === 'string' ? normalizeWallet(body.collection) : '';
    if (!profile && (![8453,84532].includes(body.chain) || !collection || /^0x0{40}$/.test(collection))) {
        throw serviceError('INVALID_COLLECTION', 'Choose the network and enter the collection contract address.');
    }
    return { p_evidence: url.href, p_chain: body.chain, p_collection: profile ? null : collection };
}
