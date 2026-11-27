import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface, ZeroAddress, ZeroHash, id, keccak256 } from 'ethers';
import { verifiedArtworkAura } from '../src/api/verified-artwork-aura.js';
import { receiptCollectionFrames, walletCollectionFrames, hasPartnerContract } from '../src/api/partner-frames.js';
import { projectedArtworkAura } from '../src/ui/components/aura-frame.js';

test('Partner designation requires matching ERC-721 support on the selected finalized chain', async () => {
    const block={number:'0x8',hash:'0x'+'ab'.repeat(32)};
    const rpc = (code,interfaces=['01ffc9a7','80ac58cd']) => async (method,params) => {
        if (method === 'eth_chainId') return '0x14a34';
        if (method === 'eth_getBlockByNumber') return block;
        assert.deepEqual(params[1],{blockHash:block.hash,requireCanonical:true});
        if (method === 'eth_getCode') return code;
        assert.equal(method,'eth_call');
        const id=params[0].data.slice(10,18);
        return '0x'+(interfaces.includes(id)?'1':'0').padStart(64,'0');
    };
    const code=rpc('0x1234'), empty=rpc('0x');
    assert.equal(await hasPartnerContract(84532,'collection',[code,code]),true);
    for (const reader of [empty,rpc('0xef0100'+'12'.repeat(20)),rpc('0x1234',[]),
        rpc('0x1234',['01ffc9a7']),rpc('0x1234',['01ffc9a7','80ac58cd','ffffffff'])]) {
        assert.equal(await hasPartnerContract(84532,'wallet',[reader,reader]),false);
    }
    await assert.rejects(hasPartnerContract(84532,'collection',[empty,code]));
    await assert.rejects(hasPartnerContract(84532,'collection',[code,rpc('0x1234',[])]));
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
  const sources = new Map([[nftAddress,{address:nftAddress,kind:'partner'}]]);
  assert.deepEqual([...await receiptCollectionFrames(items,8453,sources,readers)],[['9','partner']]);
  canonical=ZeroHash;
  assert.equal((await receiptCollectionFrames(items,8453,sources,readers)).size,0);
  assert.equal((await receiptCollectionFrames(items,84532,sources,readers)).size,0);
});

test('official collection status follows the token when the approved runtime, immutable creator and canonical mint agree', async () => {
  const code = '0x601234', issuer = '0x' + '18'.repeat(20);
  const source = {address:nftAddress,kind:'official_collection',issuer,runtime_hash:keccak256(code)};
  const sources = new Map([[nftAddress,source]]);
  const items = ['9','10'].map(id=>({id,tokenId:id,contractAddress:nftAddress,mintTransactionHash:transactionHash}));
  const receipt = {status:'0x1',blockNumber:'0xb',blockHash,transactionHash,logs:[mint,collection]};
  function reader(returnedIssuer, runtime) {
    return async (method, params) => {
      if (method === 'eth_chainId') return '0x2105';
      if (method === 'eth_getTransactionReceipt') return receipt;
      if (method === 'eth_getBlockByNumber') return params[0] === 'finalized' ? {number:'0xc'} :
        {number:'0xb',hash:blockHash,transactions:[transactionHash]};
      assert.deepEqual(params[1],{blockHash,requireCanonical:true});
      if (method === 'eth_getCode') { assert.equal(params[0],nftAddress); return runtime; }
      assert.deepEqual(params[0],{to:nftAddress,data:id('creator()').slice(0,10)});
      return '0x'+returnedIssuer.slice(2).padStart(64,'0');
    };
  }
  const rpc = reader(issuer,code);
  const read = other=>receiptCollectionFrames(items,8453,sources,[rpc,other]);
  assert.deepEqual([...await read(rpc)],[['9','platform']]);
  for (const other of [reader(recipient,code),reader(issuer,'0x6012')]) assert.equal((await read(other)).size,0);
  receipt.logs = [mint];
  assert.equal((await read(rpc)).size,0);
});

test('a reviewed external ERC-721 uses its standard mint, with shared and inconsistent contracts excluded', async () => {
  const item = {id:'9',tokenId:'9',contractAddress:nftAddress,mintTransactionHash:transactionHash};
  const receipt = {status:'0x1',blockNumber:'0xb',blockHash,transactionHash,logs:[mint]};
  const sources = new Map([[nftAddress,{address:nftAddress,kind:'partner'}]]);
  function reader(code) {
    return async (method,params) => {
      if (method === 'eth_chainId') return '0x2105';
      if (method === 'eth_getTransactionReceipt') return receipt;
      if (method === 'eth_getBlockByNumber') return params[0] === 'finalized' ? {number:'0xc'} :
        {number:'0xb',hash:blockHash,transactions:[transactionHash]};
      assert.equal(method,'eth_getCode');
      assert.deepEqual(params,[nftAddress,{blockHash,requireCanonical:true}]);
      return code;
    };
  }
  const rpc = reader('0x6001');
  const read = second=>receiptCollectionFrames([item],8453,sources,[rpc,second]);
  assert.deepEqual([...await read(rpc)],[['9','partner']]);
  assert.equal((await read(reader('0x'))).size,0);
  receipt.logs = [log('Transfer',[recipient,nftAddress,9])];
  assert.equal((await read(rpc)).size,0);
  receipt.logs = [mint,log('CollectionMinted',[1,recipient,recipient,3,1,100])];
  assert.equal((await read(rpc)).size,0);
  assert.equal(await hasPartnerContract(84532,'0x810DD5459c9cC5d82f13F8D52545a654Ec0bbe4c',[]),false);
});

test('wallet collection lookup removes the official mark on revocation and excludes a copied token on another chain', async t => {
  const settings = {ARTSOUL_AURA_SOURCES_ENABLED:'true', SUPABASE_URL:'https://database.example',
    SUPABASE_SERVICE_ROLE_KEY:'synthetic-frame-test'};
  for (const [key,value] of Object.entries(settings)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(()=>{ if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const code = '0x603010';
  const registered = [{address:nftAddress,kind:'official_collection',issuer:recipient,runtime_hash:keccak256(code)}];
  const holder = '0x'+'13'.repeat(20);
  const item = {id:'8453:'+nftAddress+':9',network:'base-mainnet',chainId:8453,contractAddress:nftAddress,
    mintTransactionHash:transactionHash,tokenId:'9',tokenType:'ERC721',quantity:'1'};
  const page = {view:'nfts',wallet:holder,items:[item,{...item,id:'1:'+nftAddress+':9',network:'eth-mainnet',chainId:1}]};
  let approved = true, receiptReads = 0;
  t.mock.method(globalThis,'fetch',async (url, options) => {
    const endpoint = new URL(url);
    if (endpoint.hostname === 'database.example') {
      if (endpoint.pathname.endsWith('/read_aura_border_setting')) return Response.json([{enabled:true,revision:3}]);
      assert.equal(endpoint.pathname,'/rest/v1/rpc/collection_frame_sources');
      assert.deepEqual(JSON.parse(options.body),{p_chain:8453,p_addresses:[nftAddress]});
      return Response.json(approved ? registered : []);
    }
    const {id,method,params} = JSON.parse(options.body);
    let result;
    switch (method) {
      case 'eth_chainId': result='0x2105'; break;
      case 'eth_getBlockByNumber': result = params[0] === 'finalized' ? {number:'0xc'} : {number:'0xb',hash:blockHash,transactions:[transactionHash]}; break;
      case 'eth_getTransactionReceipt': receiptReads++; result={status:'0x1',blockNumber:'0xb',blockHash,transactionHash,logs:[mint,collection]}; break;
      case 'eth_getCode': result=code; break;
      case 'eth_call': result='0x'+recipient.slice(2).padStart(64,'0'); break;
      default: assert.fail(method);
    }
    return Response.json({jsonrpc:'2.0',id,result});
  });
  const decorated = await walletCollectionFrames(page,holder);
  assert.deepEqual(decorated.items[0],{...item,aura_kind:'platform',aura_border_text:true});
  assert.equal(decorated.items[1].aura_kind,undefined);
  approved = false;
  assert.deepEqual(await walletCollectionFrames(page,holder),page);
  assert.equal(receiptReads,1);
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
