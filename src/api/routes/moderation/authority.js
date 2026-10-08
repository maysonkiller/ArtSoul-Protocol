import { allowMethods, normalizeWallet, readJson, requireWallet, sendError, supabaseRest } from '../../backend.js';
import { getWebAuthnConfig } from '../../moderation-passkey.js';
import { buildAuthorityApprovalMessage, verifyAuthorityApprovals } from '../../moderation-dual-wallet.js';

// Not registered in the public router until role-version-aware factor/session
// enforcement is deployed. This manages application roles, never contracts.
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function fail(code, statusCode = 400) {
  const error = new Error(code);
  error.code = code; error.statusCode = statusCode;
  throw error;
}
function exactFields(body, fields) {
  if (!body || Array.isArray(body) || Object.keys(body).sort().join('|') !== [...fields].sort().join('|')) fail('INVALID_AUTHORITY_PAYLOAD');
}
async function context(req, expectedWallet) {
  if (process.env.ARTSOUL_MODERATION_DUAL_WALLET_ENABLED !== 'true') fail('AUTHORITY_DISABLED', 404);
  const {origin} = getWebAuthnConfig();
  const wallet = requireWallet(req);
  if (typeof expectedWallet !== 'string' || normalizeWallet(expectedWallet) !== wallet) fail('AUTHORITY_WALLET_MISMATCH', 403);
  if (req.method === 'POST' && req.headers?.origin !== origin) fail('AUTHORITY_ORIGIN_MISMATCH', 403);
  const rows = await supabaseRest('artsoul_staff_authority_policy?singleton=eq.true&select=version,origin,chain_id,wallet_a,wallet_b&limit=1');
  const row = rows?.[0];
  if (!row || rows.length !== 1 || row.origin !== origin || row.chain_id !== 84532 ||
      !Number.isSafeInteger(Number(row.version)) || Number(row.version) < 1) fail('AUTHORITY_POLICY_REQUIRED', 503);
  const policy = {origin,chainId:row.chain_id,version:String(row.version),authorities:[row.wallet_a,row.wallet_b]};
  if (!policy.authorities.includes(wallet)) fail('AUTHORITY_REQUIRED', 403);
  return {wallet,policy};
}
async function storedRequest(requestId) {
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) fail('INVALID_AUTHORITY_REQUEST');
  const rows = await supabaseRest(`artsoul_staff_authority_requests?id=eq.${requestId}&consumed_at=is.null&select=id,proposal,expires_at&limit=1`);
  const row = rows?.[0];
  if (!row || rows.length !== 1 || row.id !== requestId || row.proposal?.requestId !== requestId || Date.parse(row.expires_at) <= Date.now()) fail('AUTHORITY_REQUEST_UNAVAILABLE', 409);
  return row.proposal;
}
function matchesPolicy(proposal, policy) {
  if (proposal.origin !== policy.origin || proposal.chainId !== policy.chainId || proposal.policyVersion !== policy.version ||
      proposal.authorities.join('|') !== policy.authorities.join('|')) fail('AUTHORITY_POLICY_CHANGED', 409);
}
function publicRequest(proposal, policy) {
  const message = buildAuthorityApprovalMessage(proposal);
  matchesPolicy(proposal,policy);
  if (Date.parse(proposal.issuedAt)>Date.now() || Date.parse(proposal.expiresAt)<=Date.now()) fail('AUTHORITY_REQUEST_UNAVAILABLE',409);
  return {proposal,message};
}

export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  if (!allowMethods(req,res,['GET','POST'])) return;
  try {
    // Disabled routes do not parse body, inspect sessions or access storage.
    if (process.env.ARTSOUL_MODERATION_DUAL_WALLET_ENABLED !== 'true') fail('AUTHORITY_DISABLED',404);
    if (req.method === 'GET') {
      const {policy} = await context(req,req.query?.expectedWallet);
      const request = req.query?.requestId ? publicRequest(await storedRequest(req.query.requestId),policy) : null;
      return res.status(200).json({success:true,policy,request});
    }
    const body = await readJson(req);
    const {wallet,policy} = await context(req,body?.expectedWallet);
    if (body?.operation === 'request') {
      exactFields(body,['operation','expectedWallet','action','targetWallet','role','nextAuthorities']);
      if (!['grant_role','revoke_role','rotate_authority'].includes(body.action) || !Array.isArray(body.nextAuthorities)) fail('INVALID_AUTHORITY_PAYLOAD');
      const rotation = body.action === 'rotate_authority';
      if (rotation ? (body.targetWallet !== '' || body.role !== '' || body.nextAuthorities.length !== 2) :
          (typeof body.targetWallet !== 'string' || !normalizeWallet(body.targetWallet) || /^0x0{40}$/i.test(body.targetWallet) || !['admin','moderator','team'].includes(body.role) || body.nextAuthorities.length !== 0)) fail('INVALID_AUTHORITY_PAYLOAD');
      const next = body.nextAuthorities.map(value=>typeof value === 'string' ? normalizeWallet(value) : '').sort();
      if (rotation && (!next[0] || !next[1] || next[0]===next[1] || next.some(value=>/^0x0{40}$/.test(value)))) fail('INVALID_AUTHORITY_PAYLOAD');
      const proposal = await supabaseRest('rpc/a8f_create_authority_request',{method:'POST',body:{
        p_wallet:wallet,p_action:body.action,p_target:rotation?'':normalizeWallet(body.targetWallet),p_role:body.role,
        p_next_wallet_a:next[0]||'',p_next_wallet_b:next[1]||''
      }});
      return res.status(200).json({success:true,request:publicRequest(proposal,policy)});
    }
    if (body?.operation !== 'complete') fail('INVALID_AUTHORITY_OPERATION');
    exactFields(body,['operation','expectedWallet','requestId','signatures']);
    const proposal = await storedRequest(body.requestId);
    let approval;
    try {approval = verifyAuthorityApprovals(proposal,body.signatures,policy);}
    catch {fail('BOTH_AUTHORITY_SIGNATURES_REQUIRED',403);}
    // Only server-recovered identities and the immutable stored request reach
    // the consumer. The browser cannot submit a proposal or a verified flag.
    const result = await supabaseRest('rpc/a8f_complete_authority_request',{method:'POST',body:{
      p_wallet:wallet,p_request_id:proposal.requestId,p_verified_signers:approval.signers,
      p_signatures:approval.signatures,p_message_digest:approval.digest
    }});
    if (result !== 'OK') fail('AUTHORITY_REQUEST_NOT_APPLIED',409);
    return res.status(200).json({success:true,requestId:proposal.requestId});
  } catch (error) {sendError(res,error);}
}
