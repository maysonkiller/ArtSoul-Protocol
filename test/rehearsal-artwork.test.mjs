import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { Interface, keccak256 } from 'ethers';
import { readArtworkMetadata } from '../src/api/safe-artwork-fetch.js';
import { rehearsalArtwork as work, rehearsalMetadataUri as uri, rehearsalOpening, walletRequest } from '../scripts/rehearsal-review/client.mjs';
import { checkRegistrationPublication, inspectOpeningReceipt, inspectRegistrationReceipt, openingAtHead, registrationAtHead, simulateRegisteredOpening, verifyArtworkRegistration } from '../scripts/review-rehearsal-artwork.mjs';

const market = new Interface([
    'function registerArtwork(string) returns (uint256)', 'function workCount() view returns (uint256)',
    'function works(uint256) view returns (address,string,uint256,uint256)',
    'function artworkToToken(uint256) view returns(uint256)',
    'function createAuction(uint256,uint256,uint256) returns (uint256)', 'function auctionCount() view returns (uint256)',
    'function auctions(uint256) view returns(uint256,uint256,uint256,uint256,uint256,address,uint256,uint256,uint8,address)',
    'event AuctionOpened(uint256 indexed auctionId,uint256 indexed artworkId,uint256 startPrice,uint256 end)',
    'event ArtworkRegistered(uint256 indexed artworkId,address indexed creator,string metadataURI)'
]);
const payer = '0x' + '1'.repeat(40), outsider = '0x' + '2'.repeat(40);
const hash = '0x' + 'a'.repeat(64), block = { number: '0x10', hash: '0x' + 'b'.repeat(64) };
const data = market.encodeFunctionData('registerArtwork', [uri]), value = '0x0', chainId = '0x14a34';
const digest = hex => createHash('sha256').update(Buffer.from(hex.slice(2), 'hex')).digest('hex');
const returned = (method, values) => market.encodeFunctionResult(method, values);

test('first-only opening retires its request as soon as either latest or finalized auction history appears', async () => {
    function reader(finalized, latest) {
        return async (method, [call, at]) => {
            assert.equal(method, 'eth_call');
            assert.deepEqual(call, { to: work.core, data: market.encodeFunctionData('auctionCount') });
            if (at === 'latest') return returned('auctionCount', [latest]);
            assert.deepEqual(at, { blockHash: block.hash, requireCanonical: true });
            return returned('auctionCount', [finalized]);
        };
    }
    assert.deepEqual(await openingAtHead(reader(0, 1), payer, block), { waitingForFinality: { role: 'createAuction' } });
    assert.deepEqual(await openingAtHead(reader(2, 2), payer, block), { complete: true, existingAuctionHistory: true });
});

test('opening wallet review accepts only work 1 at the displayed reserve and duration and the first pending auction ID', async () => {
    const open = market.encodeFunctionData('createAuction', [1, 1000000000000000n, 86400]);
    assert.equal(digest(open), rehearsalOpening.dataSha256);
    assert.equal(keccak256(open), '0x08130d8ab39d1264a70fbf21cfb22dd88f926ba91952124a6e0a782db8ee8a14');
    const codes = new Map([[work.core, '0x6001'], [work.nft, '0x6002']]);
    const plan = { operation: 'createAuction', target: work.core, deployments: [], payer, chainId, nonce: '0x13',
        codeChecks: [...codes].map(([address, runtime]) => ({ address, sha256: digest(runtime) })), data: open, dataSha256: digest(open) };
    let predicted = 1n;
    const provider = { request: async ({ method, params = [] }) => {
        if (method === 'eth_chainId') return chainId;
        if (method === 'eth_accounts') return [payer];
        if (method === 'eth_getTransactionCount') return plan.nonce;
        if (method === 'eth_getCode') return codes.get(params[0]) ?? '0x';
        assert.equal(method, 'eth_call');
        assert.deepEqual(params, [{ from: payer, to: work.core, data: open, value }, 'pending']);
        return returned('createAuction', [predicted]);
    } };
    assert.deepEqual(await walletRequest(provider, plan), { from: payer, to: work.core, chainId, nonce: plan.nonce, value, data: open });
    for (const args of [[2, 1000000000000000n, 86400], [1, 2000000000000000n, 86400], [1, 1000000000000000n, 172800]]) {
        const substituted = market.encodeFunctionData('createAuction', args);
        await assert.rejects(walletRequest(provider, { ...plan, data: substituted, dataSha256: digest(substituted) }), /Unexpected artwork/);
    }
    await assert.rejects(walletRequest(provider, { ...plan, target: work.nft }), /Unexpected artwork/);
    predicted = 2n;
    await assert.rejects(walletRequest(provider, plan), /Auction history changed/);
});

test('first auction rehearsal uses only hash-pinned calls for the registered, unsold work', async () => {
    let creator = payer, active = 0n, floor = 0n, token = 0n, next = 4n, simulations = 0;
    const rpc = async (method, [call, at]) => {
        assert.equal(method, 'eth_call');
        assert.deepEqual(at, { blockHash: block.hash, requireCanonical: true });
        const { name, args } = market.parseTransaction({data: call.data});
        assert.equal(call.to, name === 'artworkToToken' ? work.nft : work.core);
        if (name === 'works') return returned(name, [creator, uri, active, floor]);
        if (name === 'artworkToToken') return returned(name, [token]);
        if (name === 'auctionCount') return returned(name, [3n]);
        assert.equal(name, 'createAuction');
        assert.equal(call.from, payer);
        assert.equal(call.value, '0x0');
        assert.deepEqual([...args], [1n, 1234567890123456789n, 36n * 3600n]);
        simulations++;
        return returned(name, [next]);
    };
    const check = (reserve = '1234567890123456789', hours = '36') => simulateRegisteredOpening(rpc, payer, block, reserve, hours);
    assert.equal((await check()).simulatedAuctionId, '4');
    creator = outsider; await assert.rejects(check(), /Another account/); creator = payer;
    active = 4n; await assert.rejects(check(), /already has an auction/); active = 0n;
    token = 1n; await assert.rejects(check(), /settled or minted/); token = 0n;
    floor = 1n; await assert.rejects(check(), /settled or minted/); floor = 0n;
    for (const reserve of ['0', '-1', '1e18', (1n << 256n).toString()]) await assert.rejects(check(reserve), /reserve/);
    await assert.rejects(check('1', '12'), /hours/);
    assert.equal(simulations, 1);
    next = 5n; await assert.rejects(check(), /Unexpected simulated auction ID/);
});
const event = market.encodeEventLog('ArtworkRegistered', [7, payer, uri]);
const tx = { hash, chainId, input: data, value, from: payer, to: work.core,
    blockHash: block.hash, blockNumber: block.number, transactionIndex: '0x0' };
const receipt = { transactionHash: hash, from: payer, to: work.core, status: '0x1', blockHash: block.hash,
    blockNumber: block.number, transactionIndex: '0x0', logs: [{ ...event, address: work.core, transactionHash: hash, blockHash: block.hash,
        blockNumber: block.number, transactionIndex:'0x0', logIndex:'0x2', removed:false }] };

test('pinned registration carries one supported self-contained metadata string, within the contract limit', async () => {
    assert.equal(digest(data), work.dataSha256);
    assert.match(data, /^0x151829fc/);
    assert.equal(keccak256(data), '0x556480cecd493fa790352edfbb659bf12d96c82ed0148272301120df53ff902e');
    assert.equal(market.decodeFunctionData('registerArtwork', data)[0], uri);
    assert(Buffer.byteLength(uri) <= 2048);
    const metadata = await readArtworkMetadata(uri);
    assert.equal(metadata.name, work.title);
    assert.equal(metadata.image, 'https://artsoulprotocol.com/favicon.jpg');
});

test('a matching existing registration stops new submissions before and after finality; another first work blocks the stale plan', async () => {
    function rpc(finalCount, liveCount, creator = payer, metadata = uri) {
        return async (method, [call, at]) => {
            assert.equal(method, 'eth_call');
            assert.equal(call.to, work.core);
            if (call.data === market.encodeFunctionData('workCount')) return returned('workCount', [at === 'latest' ? liveCount : finalCount]);
            assert.equal(call.data, market.encodeFunctionData('works', [1]));
            return returned('works', [creator, metadata, 0, 0]);
        };
    }
    assert.deepEqual(await registrationAtHead(rpc(0, 1), payer, block), { waitingForFinality: { role: 'registerArtwork' } });
    assert.deepEqual(await registrationAtHead(rpc(2, 3), payer, block), { complete: true, finalizedArtwork: { id: '1' } });
    await assert.rejects(registrationAtHead(rpc(1, 1, outsider), payer, block), /Another account/);
    await assert.rejects(registrationAtHead(rpc(0, 1, payer, 'different'), payer, block), /different work/);
});

test('wallet re-simulates the exact pinned call with zero ETH and fails on a changed pending registry or altered terms', async () => {
    const codes = new Map([[work.core, '0x6001'], [work.nft, '0x6002']]);
    const plan = { operation: 'registerArtwork', target: work.core, deployments: [], payer, chainId, nonce: '0x12',
        codeChecks: [...codes].map(([address, code]) => ({ address, sha256: digest(code) })), metadataUri: uri, data, dataSha256: work.dataSha256 };
    let predicted = 1;
    const provider = { request: async ({ method, params = [] }) => {
        if (method === 'eth_chainId') return chainId;
        if (method === 'eth_accounts') return [payer];
        if (method === 'eth_getTransactionCount') return '0x12';
        if (method === 'eth_getCode') return codes.get(params[0]) || '0x';
        assert.equal(method, 'eth_call');
        assert.deepEqual(params, [{ from: payer, to: work.core, data, value }, 'pending']);
        return returned('registerArtwork', [predicted]);
    } };
    assert.deepEqual(await walletRequest(provider, plan), { from: payer, to: work.core, chainId, nonce: '0x12', value, data });
    for (const change of [{ data: data + '00' }, { dataSha256: digest('0x99') }, { target: outsider },
        { metadataUri: 'ipfs://substitute' }, { codeChecks: [] }, { deployments: [outsider] }]) {
        await assert.rejects(walletRequest(provider, { ...plan, ...change }));
    }
    predicted = 2;
    await assert.rejects(walletRequest(provider, plan), /registry changed/);
});

function receiptRpc(change = {}) {
    const answers = {
        eth_chainId: () => chainId, eth_getTransactionByHash: () => tx, eth_getTransactionReceipt: () => receipt,
        eth_getCode: () => '0x6001',
        eth_getBlockByNumber: tag => tag === 'finalized' ? block : { ...block, transactions: [hash] },
        eth_call: (call, at) => {
            assert.deepEqual(at, { blockHash: block.hash, requireCanonical: true });
            if (call.to === work.nft) {
                assert.equal(call.data, market.encodeFunctionData('artworkToToken', [7]));
                return returned('artworkToToken', [0]);
            }
            assert.equal(call.to, work.core);
            assert.equal(call.data, market.encodeFunctionData('works', [7]));
            return returned('works', [payer, uri, 0, 0]);
        }, ...change
    };
    return async (method, params) => answers[method](...params);
}

test('the reviewed zero-value auction opening matches the included transaction, event and block-pinned work', async () => {
    const reserve = 1000000000000000n, end = 86416n, zero = '0x' + '0'.repeat(40);
    const txOpen = { ...tx, value:'0x0', nonce:'0x13', input:market.encodeFunctionData('createAuction', [1,reserve,86400]) };
    const log = { ...receipt.logs[0], ...market.encodeEventLog('AuctionOpened', [1,1,reserve,end]) };
    const opened = { ...receipt, logs:[log], gasUsed:'0x30200' };
    function reader(options = {}) {
        return receiptRpc({
            eth_getTransactionByHash: () => ({ ...txOpen, ...options.tx }),
            eth_getTransactionReceipt: () => ({ ...opened, ...options.receipt }),
            eth_getBlockByNumber: tag => tag === 'finalized' ? { ...block, ...options.head } :
                { ...block, timestamp:'0x10', transactions:[hash], ...options.block },
            eth_call: (call, at) => {
                assert.deepEqual(at, {blockHash:block.hash,requireCanonical:true});
                const {name,args} = market.parseTransaction({data:call.data});
                assert.equal(args[0], 1n);
                if (name === 'artworkToToken') {
                    assert.equal(call.to, work.nft);
                    return returned(name, [options.token ?? 0]);
                }
                assert.equal(call.to, work.core);
                if (name === 'works') return returned(name, [payer,uri,1,0]);
                assert.equal(name,'auctions');
                return returned(name,[1,reserve,end,options.end ?? end,0,zero,0,0,1,zero]);
            }
        });
    }
    const result = await inspectOpeningReceipt(reader(), hash, payer);
    assert.deepEqual([result.auctionId,result.artworkId,result.reserveWei,result.durationSeconds,result.originalEnd],
        ['1','1',reserve.toString(),'86400',new Date(Number(end) * 1000).toISOString()]);
    for (const options of [{tx:{from:outsider}}, {tx:{to:work.nft}}, {tx:{value:'0x1'}}, {tx:{input:data}},
        {receipt:{status:'0x0'}}, {head:{number:'0xf'}}, {block:{transactions:[]}}, {block:{timestamp:'0x11'}},
        {token:1}, {end:end + 1n}, {receipt:{logs:[{...log,removed:true}]}}, {receipt:{logs:[log,log]}},
        {receipt:{logs:[{...log,...market.encodeEventLog('AuctionOpened',[1,2,reserve,end])}]}}]) {
        await assert.rejects(inspectOpeningReceipt(reader(options), hash, payer));
    }
});

test('receipt inclusion verifies the real work ID from the event even when another actor took the first ID', async () => {
    const result = await inspectRegistrationReceipt(receiptRpc(), hash, payer);
    assert.deepEqual(result, { block, txHash: hash, transactionIndex: '0x0', workId: '7', creator: payer, core: work.core, metadataUri: uri,
        logCount: 1, logIndex:'2', atRegistrationBlock:{activeAuctionId:null,canonicalFloorWei:'0',tokenId:null} });
});

test('registration evidence follows the same publication recovery path and exact log as the signed rehearsal', async () => {
    const checked = await inspectRegistrationReceipt(receiptRpc(), hash, payer);
    const register = {chainId:84532,core:{address:work.core,codeHash:keccak256('0x6001')}};
    const result = await checkRegistrationPublication(checked, register, [receiptRpc(),receiptRpc()]);
    assert.equal(result.core_address,work.core.toLowerCase());
    assert.equal(result.can_submit,false);
    assert.equal(result.registrations[0].log_index,'2');
    assert.deepEqual(result.finalized_anchor,{number:'16',hash:block.hash});
    await assert.rejects(checkRegistrationPublication({...checked,logIndex:'3'},register,[receiptRpc(),receiptRpc()]),/differs/);
    await assert.rejects(checkRegistrationPublication(checked,register,[receiptRpc(),receiptRpc({eth_getCode:()=>'0x6002'})]),/RECOVERY_CODE_MISMATCH/);
});

test('the receipt state is block scoped and reports an auction opened later in the registration block', async () => {
    const stage = (floor,token) => receiptRpc({eth_call:(call,at) => {
        assert.deepEqual(at,{blockHash:block.hash,requireCanonical:true});
        return call.to === work.nft ? returned('artworkToToken',[token]) : returned('works',[payer,uri,24,floor]);
    }});
    const observed = await inspectRegistrationReceipt(stage(0,0), hash, payer);
    assert.deepEqual(observed.atRegistrationBlock,{activeAuctionId:'24',canonicalFloorWei:'0',tokenId:null});
    await assert.rejects(inspectRegistrationReceipt(stage(1,0),hash,payer),/Unexpected floor/);
    await assert.rejects(inspectRegistrationReceipt(stage(0,5),hash,payer),/Unexpected token/);
});

test('a failed or substituted request, event, chain, block or stored work cannot count as a registration', async () => {
    const changes = [
        { eth_getTransactionReceipt: () => null }, { eth_chainId: () => '0x2105' },
        ...[{ value: '0x1' }, { input: '0x' }, { from: outsider }, { to: work.nft }, { transactionIndex: '0x1' }, { chainId: '0x2105' }].map(change => ({
            eth_getTransactionByHash: () => ({ ...tx, ...change }) })),
        ...[{ status: '0x0' }, { logs: [] }, { logs: [...receipt.logs, ...receipt.logs] },
            ...[{ address: work.nft }, { removed: true }, { transactionHash: block.hash }, { topics: [] },
                {blockNumber:'0x20'},{transactionIndex:'0x3'},{logIndex:'0x02'},{data:event.data+'00'},{topics:[...event.topics,hash]}]
                .map(change => ({ logs: [{ ...receipt.logs[0], ...change }] }))
        ].map(change => ({ eth_getTransactionReceipt: () => ({ ...receipt, ...change }) })),
        { eth_getBlockByNumber: tag => tag === 'finalized' ? { ...block, number: '0xf' } : block },
        { eth_getBlockByNumber: tag => tag === 'finalized' ? block : { ...block, transactions: [] } },
        { eth_call: () => returned('works', [payer, 'other', 0, 0]) }
    ];
    for (const change of changes) await assert.rejects(inspectRegistrationReceipt(receiptRpc(change), hash, payer));
    const review = { chainId: 84532, expectedCore: work.core, expectedNFT: work.nft, payer };
    const register = { chainId: 84532, core: { address: work.core, codeHash: work.coreHash }, nft: { address: work.nft, codeHash: work.nftHash } };
    await assert.rejects(verifyArtworkRegistration(review, register, hash, [receiptRpc(), receiptRpc(changes[0])]), /unavailable/);
    await assert.rejects(verifyArtworkRegistration(review, { ...register, chainId: 8453 }, hash, []));
    await assert.rejects(verifyArtworkRegistration({ ...review, expectedCore: outsider }, register, hash, []), /payout pair/);
});
