import { allowMethods, normalizeWallet, sendError, supabaseRest } from '../../backend.js';
import { requireService, serviceError } from '../../launch-services.js';
import { reviewBody } from '../../identity-applications.js';
import { verifiedReviewActor } from '../../frame-source-access.js';
import { platformPublisherFor } from '../../platform-artwork-aura.js';
import { rehearsalCore } from '../../../../scripts/rehearsal-review/deployment.mjs';

export default async function handler(req,res) {
    res.setHeader('Cache-Control','private, no-store');
    if (!allowMethods(req,res,['GET','POST'])) return;
    try {
        requireService('ARTSOUL_AURA_SOURCES_ENABLED');
        const actor = await verifiedReviewActor(req);
        const {kind,chain,address,after,deployment} = req.query || {};
        const invalid = () => serviceError('INVALID_SOURCE','Choose a valid network, wallet or contract.');
        if (!['platform','partner'].includes(kind) || !['8453','84532'].includes(chain) ||
            (kind === 'platform' && chain !== '84532') ||
            (deployment !== undefined && (kind !== 'platform' || !['catalog','rehearsal'].includes(deployment)))) throw invalid();
        const subject = address === undefined ? null : normalizeWallet(address);
        if (address !== undefined && (!subject || /^0x0{40}$/.test(subject)) ||
            after !== undefined && (!normalizeWallet(after) || address !== undefined)) throw invalid();
        const publishingCore = deployment === 'rehearsal' ? rehearsalCore : process.env.ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA;
        const scope = kind === 'platform' ? normalizeWallet(publishingCore || '') : '';
        if (kind === 'platform' && (!scope || /^0x0{40}$/.test(scope))) throw serviceError('CORE_UNAVAILABLE','The active publishing contract has not been configured.',503);
        const params = {...actor.params,p_kind:kind,p_chain:Number(chain),p_scope:scope,p_address:subject,p_after:after?.toLowerCase() || '',
            p_revision:null,p_enabled:null,p_reason:null};
        if (req.method === 'POST') {
            const body = await reviewBody(req,'enabled,reason,revision,scope',actor.origin);
            if (body.scope !== scope) throw serviceError('SOURCE_CHANGED','The active deployment changed. Review this source again.',409);
            if (!subject || typeof body.enabled !== 'boolean' || !Number.isInteger(body.revision) || body.revision < 0 ||
                body.revision >= 2147483647 || typeof body.reason !== 'string' || body.reason.trim().length < 5 ||
                body.reason.trim().length > 500) throw invalid();
            Object.assign(params,{p_enabled:body.enabled,p_revision:body.revision,p_reason:body.reason.trim()});
        }
        const rows = await supabaseRest('rpc/manage_aura_sources',{method:'POST',body:params});
        if (!Array.isArray(rows) || rows.length > (subject ? 1 : 26) ||
            rows.some(r=>!normalizeWallet(r.address) || typeof r.enabled !== 'boolean' || !Number.isInteger(r.revision) || r.revision < 1) ||
            (req.method === 'POST' && (rows[0]?.address !== subject || rows[0]?.enabled !== params.p_enabled || rows[0]?.revision !== params.p_revision+1))) {
            throw serviceError('SOURCE_UNCONFIRMED','Reload this source before continuing.',503);
        }
        const configured = kind === 'platform' && platformPublisherFor({chainId:Number(chain),coreAddress:scope});
        return res.status(200).json({scope, configuredPublisher:configured || null, sources:subject && !rows.length ?
            [{address:subject,revision:0,enabled:subject === configured}] : rows.slice(0,25), next:rows.length === 26 ? rows[24].address : null});
    } catch(error) {
        if (error.details?.message === 'SOURCE_CHANGED') error = serviceError('SOURCE_CHANGED','Another reviewer changed the source. Reload it.',409);
        if (error.details?.message === 'AURA_ADMIN_REQUIRED') error = serviceError('REVIEWER_REQUIRED','Verify an authorized staff wallet.',403);
        return sendError(res,error);
    }
}
