import { hashMessage, verifyMessage } from 'ethers';
import { WEBAUTHN_CHALLENGE_TTL_MS } from './moderation-passkey.js';

// Application authority only; no contract calls, role writes or enrollment.
// A verified pair is evidence for the atomic proposal consumer, not a session.
// The caller must load the current policy/role version and proposal from the
// server registry, then recheck them under the mutation transaction's locks.
const ROLES = new Set(['admin', 'moderator', 'team']);
const FIELDS = ['requestId', 'origin', 'chainId', 'policyVersion', 'authorities',
  'action', 'targetWallet', 'role', 'roleVersion', 'nextAuthorities', 'issuedAt', 'expiresAt'];
const ACTIONS = new Set(['grant_role', 'revoke_role', 'rotate_authority']);
const ZERO = '0x' + '0'.repeat(40);

function requireCondition(ok) {
  if (!ok) throw new TypeError('INVALID_AUTHORITY_PROPOSAL');
}
function address(value) {
  requireCondition(typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value) && value !== ZERO);
  return value;
}
function pair(value) {
  requireCondition(Array.isArray(value) && value.length === 2);
  const result = value.map(address);
  requireCondition(result[0] < result[1]); // Canonical, distinct current signers.
  return result;
}
function version(value, allowZero = false) {
  requireCondition(typeof value === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(value) &&
    Number.isSafeInteger(Number(value)) && (allowZero || value !== '0'));
}
function timestamp(value) {
  requireCondition(typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
  return Date.parse(value);
}

export function buildAuthorityApprovalMessage(proposal) {
  requireCondition(proposal && typeof proposal === 'object' && !Array.isArray(proposal));
  requireCondition(Object.keys(proposal).sort().join('|') === [...FIELDS].sort().join('|'));
  requireCondition(typeof proposal.requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(proposal.requestId));
  let origin;
  try { origin = new URL(proposal.origin); } catch { requireCondition(false); }
  requireCondition(typeof proposal.origin === 'string' && origin.protocol === 'https:' && origin.origin === proposal.origin);
  requireCondition(proposal.chainId === 84532 && ACTIONS.has(proposal.action));
  version(proposal.policyVersion);version(proposal.roleVersion, true);
  const authorities = pair(proposal.authorities);
  const issued = timestamp(proposal.issuedAt), expires = timestamp(proposal.expiresAt);
  requireCondition(expires > issued && expires - issued <= WEBAUTHN_CHALLENGE_TTL_MS);
  if (proposal.action === 'rotate_authority') {
    pair(proposal.nextAuthorities);
    requireCondition(proposal.nextAuthorities.join('|') !== authorities.join('|') &&
      proposal.targetWallet === '' && proposal.role === '' && proposal.roleVersion === '0');
  } else {
    address(proposal.targetWallet);
    requireCondition(ROLES.has(proposal.role) && Array.isArray(proposal.nextAuthorities) && proposal.nextAuthorities.length === 0);
    if (proposal.action === 'revoke_role') requireCondition(proposal.roleVersion !== '0');
  }
  const action = {grant_role:'Grant staff role',revoke_role:'Revoke staff role',rotate_authority:'Replace administration authority'}[proposal.action];
  return [
    'ArtSoul administration approval',
    'Application administration only. This does not authorize a payment or change contract ownership.',
    `Origin: ${proposal.origin}`, `Chain ID: ${proposal.chainId}`,
    `Request ID: ${proposal.requestId}`, `Authority version: ${proposal.policyVersion}`,
    `Current authorities: ${authorities.join(', ')}`, `Action: ${action}`,
    `Target wallet: ${proposal.targetWallet || 'not applicable'}`, `Staff role: ${proposal.role || 'not applicable'}`,
    `Current role version: ${proposal.roleVersion}`,
    `Replacement authorities: ${proposal.nextAuthorities.join(', ') || 'not applicable'}`,
    `Issued at: ${proposal.issuedAt}`, `Expires at: ${proposal.expiresAt}`,
    'Both current authorities must sign this exact request. Each request can be applied once.'
  ].join('\n');
}

export function verifyAuthorityApprovals(proposal, signatures, currentPolicy, now = Date.now()) {
  const message = buildAuthorityApprovalMessage(proposal);
  requireCondition(Number.isSafeInteger(now) && timestamp(proposal.issuedAt) <= now && timestamp(proposal.expiresAt) > now);
  requireCondition(currentPolicy && currentPolicy.origin === proposal.origin && currentPolicy.chainId === proposal.chainId &&
    currentPolicy.version === proposal.policyVersion && pair(currentPolicy.authorities).join('|') === proposal.authorities.join('|'));
  requireCondition(Array.isArray(signatures) && signatures.length === 2 &&
    signatures.every(signature => typeof signature === 'string' && /^0x[0-9a-fA-F]{130}$/.test(signature)));
  let approvals;
  try {
    approvals = signatures.map(signature => ({signer:verifyMessage(message, signature).toLowerCase(),signature}))
      .sort((a,b)=>a.signer < b.signer ? -1 : a.signer > b.signer ? 1 : 0);
  }
  catch { requireCondition(false); }
  const signers = approvals.map(approval=>approval.signer);
  requireCondition(signers.join('|') === proposal.authorities.join('|'));
  return { requestId: proposal.requestId, digest: hashMessage(message), policyVersion: proposal.policyVersion,
    signers, signatures:approvals.map(approval=>approval.signature) };
}
