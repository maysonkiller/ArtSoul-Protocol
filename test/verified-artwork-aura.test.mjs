import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface, ZeroAddress, ZeroHash } from 'ethers';
import { verifiedArtworkAura } from '../src/api/verified-artwork-aura.js';
import { receiptPartnerFrames, hasPartnerContract } from '../src/api/partner-frames.js';
import { projectedArtworkAura } from '../src/ui/components/aura-frame.js';

test('Partner designation requires contract code on the selected network', async () => {
    const rpc = (chain, code) => async method => method === 'eth_chainId' ? chain : code;
    const code = rpc('0x14a34','0x1234');
    const empty = rpc('0x14a34','0x');
    const delegated = rpc('0x14a34','0xef0100' + '12'.repeat(20));
    assert.equal(await hasPartnerContract(84532, 'collection', [code, code]), true);
    for (const reader of [empty,delegated]) assert.equal(await hasPartnerContract(84532,'wallet',[reader,reader]),false);
    await assert.rejects(hasPartnerContract(84532,'collection',[empty,code]));
    await assert.rejects(hasPartnerContract(8453,'collection',[code,code]));
});

const abi = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'event Locked(uint256 tokenId)',
  'event GenesisGranted(uint256 indexed tokenId, address indexed recipient, uint8 indexed category, bytes32 decisionHash)',
  'event CollectionMinted(uint256 indexed phaseId, address indexed payer, address indexed recipient, uint256 firstTokenId, uint256 quantity, uint256 unitPrice)'
]);
const nftAddress = '0x' + '31'.repeat(20), recipient = '0x' + '42'.repeat(20);
const blockHash = '0x' + '51'.repeat(32), transactionHash = '0x' + '62'.repeat(32);
const identity = {chainId: 8453, nftAddress, tokenId: '9'};
const deployment = {chainId: 8453, address: nftAddress};
const log = (name, args) => ({
  address: nftAddress, blockHash, transactionHash, ...abi.encodeEventLog(abi.getEvent(name), args)
});
const mint = log('Transfer', [ZeroAddress, recipient, 9n]);
const grant = log('GenesisGranted', [9n, recipient, 1, transactionHash]);
const lock = log('Locked', [9n]);
const collection = log('CollectionMinted', [2, recipient, recipient, 7, 3, 400n]);
test('partner inventory requires final canonical mint evidence for each token in the approved collection', async () => {
  const items = ['9','10'].map(id=>({id,tokenId:id,contractAddress:nftAddress,mintTransactionHash:transactionHash}));
  const receipt = {status:'0x1',blockNumber:'0xb',blockHash,transactionHash,logs:[mint,collection]};
  let canonical=blockHash;
  const readers=[async method=>method==='eth_chainId' ? '0x2105' : receipt,
    async (method,[tag])=>method==='eth_chainId' ? '0x2105' : tag==='finalized' ? {number:'0xc'} :
      {number:'0xb',hash:canonical,transactions:[transactionHash]}];
  assert.deepEqual([...await receiptPartnerFrames(items,8453,readers)],['9']);
  canonical=ZeroHash;
  assert.equal((await receiptPartnerFrames(items,8453,readers)).size,0);
  assert.equal((await receiptPartnerFrames(items,84532,readers)).size,0);
});
function evidence(logs = [mint, lock, grant, collection]) {
  return { platformRegistration: {...deployment, tokenId: '9'}, genesisDeployment: deployment,
    partnerReview: {...deployment, approved: true}, canonicalMintBlock: {chainId: 8453, number: 11, hash: blockHash, finalizedThrough: 12},
    receipt: {status: 1, blockNumber: 11, blockHash, hash: transactionHash, logs} };
}

test('the same NFT resolves to exactly one frame for all eight combinations of confirmed sources', () => {
  for (const platform of [false, true]) for (const genesis of [false, true]) for (const partner of [false, true]) {
    const source = evidence();
    if (!platform) delete source.platformRegistration;
    if (!genesis) delete source.genesisDeployment;
    if (!partner) delete source.partnerReview;
    const kind = verifiedArtworkAura(identity, source);
    assert.equal(kind, platform ? 'platform' : genesis ? 'genesis' : partner ? 'partner' : null);
    const card = {source: 'v41_projection', minted: true, ownership_status: 'verified', chain_id: 8453, aura_kind: kind};
    const frame = projectedArtworkAura(card);
    assert.equal(frame?.className ?? null, kind ? 'artsoul-aura-frame artsoul-aura-frame--' + kind : null);
  }
});

test('a replaced block, reverted receipt or incomplete mint cannot carry a frame onto another NFT', () => {
  for (const change of [
    s => { s.canonicalMintBlock.hash = transactionHash; }, s => { s.canonicalMintBlock.finalizedThrough = 10; },
    s => { s.receipt.status = 0; }, s => { s.receipt.blockNumber++; }, s => { s.receipt.hash = blockHash; },
    s => { s.receipt.logs[0] = {...mint, removed: true}; }, s => { s.receipt.logs.push(mint); },
    s => { s.receipt.logs[0] = {...mint, address: recipient}; }, s => { s.receipt.logs[0] = {...mint, blockHash: transactionHash}; },
    s => { s.receipt.logs[0] = log('Transfer', [recipient, nftAddress, 9]); },
    s => { s.receipt.logs[0] = log('Transfer', [ZeroAddress, nftAddress, 9]); },
    s => { s.receipt.logs[0] = log('Transfer', [ZeroAddress, recipient, 10]); }
  ]) {
    const source = evidence();
    delete source.platformRegistration;
    change(source);
    assert.equal(verifiedArtworkAura(identity, source), null);
  }
});

test('a grant belongs to its dedicated mainnet token and a reviewed collection needs its own mint range', () => {
  const source = evidence([mint, lock, grant]);
  delete source.platformRegistration;
  assert.equal(verifiedArtworkAura(identity, source), 'genesis');
  assert.equal(verifiedArtworkAura({...identity, chainId: 84532}, {...source,
    genesisDeployment: {...deployment, chainId: 84532}, canonicalMintBlock: {...source.canonicalMintBlock, chainId: 84532}}), null);
  source.receipt.logs[2] = log('GenesisGranted', [9, recipient, 1, ZeroHash]);
  assert.equal(verifiedArtworkAura(identity, source), null);
  for (const logs of [[mint, grant], [mint, grant, lock], [mint, lock, lock, grant],
      [mint, {...lock, address: recipient}, grant], [mint, log('Locked', [10]), grant]]) {
    assert.equal(verifiedArtworkAura(identity, {...source, receipt: {...source.receipt, logs}}), null);
  }
  source.receipt.logs = [mint, collection];
  assert.equal(verifiedArtworkAura(identity, source), 'partner');
  for (const review of [{...deployment, verified: true}, {...deployment, approved: false}, {...deployment, address: recipient, approved: true}]) {
    assert.equal(verifiedArtworkAura(identity, {...source, partnerReview: review}), null);
  }
  source.receipt.logs[1] = log('CollectionMinted', [1, recipient, recipient, 5, 4, 400]);
  assert.equal(verifiedArtworkAura(identity, source), null);
  source.receipt.logs[1] = {...collection, address: recipient};
  assert.equal(verifiedArtworkAura(identity, source), null);
  assert.equal(verifiedArtworkAura(identity, {top100k: 9, genesis: true, partner: true, aura_kind:'platform'}), null);
  assert.equal(verifiedArtworkAura(identity, {platformRegistration: {...deployment, tokenId:'10'}}), null);
});
