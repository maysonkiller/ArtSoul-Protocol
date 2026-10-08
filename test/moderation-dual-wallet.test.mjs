import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { buildAuthorityApprovalMessage, verifyAuthorityApprovals } from '../src/api/moderation-dual-wallet.js';

// Ephemeral test keys only. No project wallet, RPC, signer or environment secret.
const wallets = [Wallet.createRandom(), Wallet.createRandom()].sort((a,b)=>a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
const outsider = Wallet.createRandom();
const now = Date.UTC(2026,9,8,12);
const policy = {version:'1',origin:'https://artsoulprotocol.com',chainId:84532,authorities:wallets.map(w=>w.address.toLowerCase())};
const proposal = {requestId:'12345678-1234-4234-8234-123456789012',origin:policy.origin,chainId:84532,
  policyVersion:'1',authorities:policy.authorities,action:'grant_role',targetWallet:outsider.address.toLowerCase(),
  role:'moderator',roleVersion:'0',nextAuthorities:[],issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+300000).toISOString()};
const signatures = await Promise.all(wallets.map(wallet=>wallet.signMessage(buildAuthorityApprovalMessage(proposal))));

test('both independent current authorities approve the exact gasless application request', () => {
  const result = verifyAuthorityApprovals(proposal, signatures, policy, now);
  assert.deepEqual(result.signers,policy.authorities);
  assert.equal(result.requestId,proposal.requestId);assert.match(result.digest,/^0x[0-9a-f]{64}$/);
  assert.deepEqual(verifyAuthorityApprovals(proposal,[...signatures].reverse(),policy,now),result);
  assert.match(buildAuthorityApprovalMessage(proposal),/does not authorize a payment or change contract ownership/);
});
for (const [label,sigs] of [['one signature',[signatures[0]]],['same signer twice',[signatures[0],signatures[0]]],
  ['extra signature',[...signatures,signatures[0]]],['outsider',[signatures[0],await outsider.signMessage(buildAuthorityApprovalMessage(proposal))]],
  ['malformed signature',[signatures[0],'0x'+'00'.repeat(65)]]]) {
  test(`rejects ${label}`,()=>assert.throws(()=>verifyAuthorityApprovals(proposal,sigs,policy,now),/INVALID_AUTHORITY_PROPOSAL/));
}
for(const [field,value] of Object.entries({requestId:'22345678-1234-4234-8234-123456789012',origin:'https://other.example',
  chainId:1,policyVersion:'2',action:'revoke_role',targetWallet:wallets[0].address.toLowerCase(),role:'admin',roleVersion:'1',
  issuedAt:new Date(now-1).toISOString(),expiresAt:new Date(now+299999).toISOString()})) {
  test(`signature binds ${field}`,()=>assert.throws(()=>verifyAuthorityApprovals({...proposal,[field]:value},signatures,policy,now),/INVALID_AUTHORITY_PROPOSAL/));
}
for(const [name,patch] of [['unknown command',{action:'execute'}],['unknown parameter',{calldata:'0x'}],['line injection',{role:'admin\nAction: Transfer'}],
  ['zero target',{targetWallet:'0x'+'0'.repeat(40)}],['unsafe role version',{roleVersion:'9007199254740992'}],
  ['noncanonical role version',{roleVersion:'01'}],['authority duplicates',{authorities:[policy.authorities[0],policy.authorities[0]]}],
  ['overlong lifetime',{expiresAt:new Date(now+300001).toISOString()}],['origin credentials',{origin:'https://user@artsoulprotocol.com'}],
  ['origin path',{origin:policy.origin+'/admin'}],['non-HTTPS origin',{origin:'http://artsoulprotocol.com'}]]) {
  test(`rejects ${name}`,()=>assert.throws(()=>buildAuthorityApprovalMessage({...proposal,...patch}),/INVALID_AUTHORITY_PROPOSAL/));
}
test('expiry, future issue and replaced authority policy fail closed',()=>{
  for(const time of [now-1,now+300000,NaN]) assert.throws(()=>verifyAuthorityApprovals(proposal,signatures,policy,time));
  for(const patch of [{version:'2'},{origin:'https://other.example'},{chainId:1},
    {authorities:[policy.authorities[0],outsider.address.toLowerCase()].sort()}]) assert.throws(()=>verifyAuthorityApprovals(proposal,signatures,{...policy,...patch},now));
});
test('authority rotation requires the current pair; replacement signatures cannot authorize themselves',async()=>{
  const next=[Wallet.createRandom(),Wallet.createRandom()].sort((a,b)=>a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  const rotation={...proposal,action:'rotate_authority',targetWallet:'',role:'',nextAuthorities:next.map(w=>w.address.toLowerCase())};
  const message=buildAuthorityApprovalMessage(rotation);
  assert(verifyAuthorityApprovals(rotation,await Promise.all(wallets.map(w=>w.signMessage(message))),policy,now));
  const newSignatures=await Promise.all(next.map(w=>w.signMessage(message)));
  assert.throws(()=>verifyAuthorityApprovals(rotation,newSignatures,policy,now));
  assert.throws(()=>buildAuthorityApprovalMessage({...rotation,nextAuthorities:policy.authorities}));
});
