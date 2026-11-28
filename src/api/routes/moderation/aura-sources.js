import { allowMethods, normalizeWallet, sendError, supabaseRest } from '../../backend.js';
import { requireService, serviceError } from '../../launch-services.js';
import { reviewBody } from '../../identity-applications.js';
import { verifiedReviewActor } from '../../frame-source-access.js';
import { profileGenesisDeployment } from '../../profile-genesis.js';
import { discoverOfficialCollection, hasPartnerContract, officialCollectionRuntime } from '../../partner-frames.js';
import { rehearsalCore } from '../../../../scripts/rehearsal-review/deployment.mjs';

export default async function handler(req,res) {
    res.setHeader('Cache-Control','private, no-store');
    if (!allowMethods(req,res,['GET','POST'])) return;
    try {
        requireService('ARTSOUL_AURA_SOURCES_ENABLED');
        const actor = await verifiedReviewActor(req, { frameWrite:req.method === 'POST' });
        const {kind,chain,address,after,deployment,issuer} = req.query || {};
        const invalid = () => serviceError('INVALID_SOURCE','Choose a valid network, wallet or contract.');
        const publisher = kind === 'platform' || kind === 'founder';
        const artist = ['artist_founder','artist_partner','artist_genesis'].includes(kind);
        const official = kind === 'official_collection';
        const genesis = kind === 'genesis';
        if ((!artist && !publisher && !official && !genesis && kind !== 'partner') || !['8453','84532'].includes(chain) ||
            (genesis && chain !== '8453') || (!official && issuer !== undefined) ||
            (deployment !== undefined && (!publisher || !['catalog','rehearsal'].includes(deployment))) ||
            (deployment === 'rehearsal' && chain !== '84532')) throw invalid();
        const subject = address === undefined ? null : normalizeWallet(address);
        if (address !== undefined && (!subject || /^0x0{40}$/.test(subject)) ||
            after !== undefined && (!normalizeWallet(after) || address !== undefined)) throw invalid();
        const body = req.method === 'POST' ? await reviewBody(req,'enabled,reason,revision,scope',actor.origin) : null;
        if (req.method === 'POST' && (!subject || typeof body.enabled !== 'boolean' || !Number.isInteger(body.revision) ||
            body.revision < 0 || body.revision >= 2147483647 || typeof body.reason !== 'string' ||
            body.reason.trim().length < 5 || body.reason.trim().length > 500)) throw invalid();
        const publishingCore = deployment === 'rehearsal' ? rehearsalCore : chain === '84532' ?
            process.env.ARTSOUL_CORE_ADDRESS_BASE_SEPOLIA : process.env.ARTSOUL_CORE_ADDRESS_BASE_MAINNET;
        let scope = publisher ? normalizeWallet(publishingCore || '') : official && issuer !== undefined ? normalizeWallet(issuer) : '';
        let runtimeObserved = null;
        const databaseQuery = { ...actor.params,p_chain:Number(chain),p_address:subject,p_after:after?.toLowerCase() || '' };
        if (official && issuer === undefined) {
            const rows = await supabaseRest('rpc/review_official_frame_sources',{method:'POST',body:databaseQuery});
            if (!Array.isArray(rows) || rows.length>(subject ? 1 : 26) || rows.some(row=>
                !normalizeWallet(row.address) || !normalizeWallet(row.issuer) || (subject && row.address!==subject) ||
                typeof row.enabled!=='boolean' || !Number.isInteger(row.revision) || row.revision<1)) {
                throw serviceError('SOURCE_UNCONFIRMED','Could not read the reviewed collection sources.',503);
            }
            if (!subject) return res.status(200).json({scope:'',sources:rows.slice(0,25),next:rows.length===26 ? rows[24].address : null});
            if (rows.length) scope = rows[0].issuer;
            else {
                const reviewed = await discoverOfficialCollection(Number(chain),subject).catch(() => {
                    throw serviceError('SOURCE_UNAVAILABLE','Could not read the collection issuer. Try again.',503);
                });
                if (!reviewed) throw serviceError('INVALID_SOURCE','Enter a deployed ArtSoul collection contract on this network.');
                scope=reviewed.issuer;
                runtimeObserved=reviewed.runtime;
            }
        }
        if (publisher && (!scope || /^0x0{40}$/.test(scope))) throw serviceError('CORE_UNAVAILABLE','The active publishing contract has not been configured.',503);
        if (official && (!scope || /^0x0{40}$/.test(scope))) throw invalid();
        const configuredGenesis = genesis ? profileGenesisDeployment()?.p_genesis || null : null;
        const params = {...actor.params,...(artist ? {p_frame:kind.slice(7)} : {p_kind:kind,p_scope:scope}),
            p_chain:Number(chain),p_address:subject,p_after:after?.toLowerCase() || '',
            p_revision:null,p_enabled:null,p_reason:null};
        if (req.method === 'POST') {
            if (body.scope !== scope) throw serviceError('SOURCE_CHANGED','The active deployment changed. Review this source again.',409);
            Object.assign(params,{p_enabled:body.enabled,p_revision:body.revision,p_reason:body.reason.trim()});
            if (genesis && body.enabled && subject !== configuredGenesis) {
                throw serviceError('GENESIS_UNAVAILABLE','Choose the reviewed Base mainnet Genesis deployment.',409);
            }
            if (official && body.enabled) {
                const runtime = runtimeObserved || await officialCollectionRuntime(Number(chain),subject,scope).catch(() => {
                    throw serviceError('SOURCE_UNAVAILABLE','Could not verify the collection deployment. Try again.',503);
                });
                if (!runtime) throw serviceError('INVALID_SOURCE','The reviewed ArtSoul collection code and original creator must both match.');
                params.p_runtime_hash=runtime;
            }
            if (kind === 'partner' && body.enabled) {
                const hasCode = await hasPartnerContract(Number(chain),subject).catch(() => {
                    throw serviceError('SOURCE_UNAVAILABLE','Could not check the collection contract. Try again.',503);
                });
                if (!hasCode) throw serviceError('INVALID_SOURCE','Enter the ERC-721 collection contract address on the selected network.');
            }
        }
        const rows = await supabaseRest(artist ? 'rpc/manage_artist_frames' : 'rpc/manage_aura_sources',{method:'POST',body:params});
        if (!Array.isArray(rows) || rows.length > (subject ? 1 : 26) ||
            rows.some(r=>!normalizeWallet(r.address) || typeof r.enabled !== 'boolean' || !Number.isInteger(r.revision) || r.revision < 1) ||
            (req.method === 'POST' && (rows[0]?.address !== subject || rows[0]?.enabled !== params.p_enabled || rows[0]?.revision !== params.p_revision+1))) {
            throw serviceError('SOURCE_UNCONFIRMED','Reload this source before continuing.',503);
        }
        return res.status(200).json({scope,...(genesis ? {configuredGenesis} : {}),sources:subject && !rows.length ?
            [{address:subject,revision:0,enabled:false}] : rows.slice(0,25), next:rows.length === 26 ? rows[24].address : null});
    } catch(error) {
        if (error.details?.message === 'SOURCE_CHANGED') error = serviceError('SOURCE_CHANGED','Another reviewer changed the source. Reload it.',409);
        if (error.details?.message === 'AURA_ADMIN_REQUIRED') error = serviceError('REVIEWER_REQUIRED','Verify an authorized staff wallet.',403);
        if (error.details?.message === 'FRAME_TEAM_REQUIRED') error = serviceError('FRAME_TEAM_REQUIRED','Verify a Team wallet in the current governing pair.',403);
        if (error.details?.message === 'GENESIS_UNAVAILABLE') error = serviceError('GENESIS_UNAVAILABLE','The reviewed Genesis issuer has no verified mainnet evidence.',409);
        return sendError(res,error);
    }
}
