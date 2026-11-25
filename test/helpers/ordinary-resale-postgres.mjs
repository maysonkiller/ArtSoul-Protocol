import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Interface, MaxUint256, keccak256, toQuantity } from 'ethers';

const address = n => '0x' + n.toString(16).padStart(40, '0');
const hash = n => '0x' + n.toString(16).padStart(64, '0');
const unit = 1n << 240n, version = 1n << 252n, artwork = 1n << 245n;
const price = unit * 200n + 1n;
const shares = [185n * unit + 1n, 11n * unit, 2n * unit, 2n * unit];
const abi = new Interface([
    'function nft() view returns (address)', 'function core() view returns (address)',
    'function tokenToArtwork(uint256) view returns (uint256)', 'function tokenCreator(uint256) view returns (address)',
    'function firstCollector(uint256) view returns (address)', 'function protocolTreasury() view returns (address)',
    'function ecosystemTreasury() view returns (address)',
    'event ResalePurchased(uint256 indexed tokenId,uint256 version,address indexed seller,address indexed buyer,uint256 price)',
    'event ResaleCredited(uint256 indexed tokenId,uint256 indexed version,address protocol,address ecosystem,uint256,uint256,uint256,uint256)',
    'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)'
]);

// This fixture serves ABI-encoded evidence from memory. No network or wallet is used.
export function resaleFixture(id, locationOverrides = {}) {
    const core = address(id), nft = address(id + 10), protocol = address(7), ecosystem = address(8);
    const pair = { chainId:84532, coreAddress:core, nftAddress:nft,
        expectedCoreCodeHash:keccak256('0x6001'), expectedNftCodeHash:keccak256('0x6002') };
    const location = { blockNumber:100 + id, blockHash:hash(100 + id), transactionHash:hash(1000 + id),
        logIndex:1, ...locationOverrides };
    const {blockHash, transactionHash} = location;
    const blockNumber = toQuantity(location.blockNumber);
    const common = {blockNumber, blockHash, transactionHash, transactionIndex:'0x0'};
    const log = (address, index, name, args) => ({...common, address, logIndex:toQuantity(index), ...abi.encodeEventLog(name, args)});
    function provider(origin, buyer = address(6)) {
        const seller = address(5);
        const logs = [];
        function purchase(index, listingVersion, from, to) {
            logs.push(log(core, index - 1, 'ResaleCredited', [MaxUint256, listingVersion, protocol, ecosystem, ...shares]),
                log(core, index, 'ResalePurchased', [MaxUint256, listingVersion, from, to, price]),
                log(nft, index + 1, 'Transfer', [from, to, MaxUint256]));
        }
        purchase(1, version, seller, buyer);
        purchase(5, version + 1n, buyer, seller);
        const values = { nft, core, protocolTreasury:protocol, ecosystemTreasury:ecosystem,
            tokenToArtwork:artwork, tokenCreator:seller, firstCollector:address(9) };
        const send = async (method, params) => {
            if (method === 'eth_chainId') return toQuantity(pair.chainId);
            if (method === 'eth_getBlockByNumber') {
                assert.ok([blockNumber, 'finalized'].includes(params[0]));
                return { number:blockNumber, hash:blockHash, transactions:[transactionHash] };
            }
            if (method === 'eth_getTransactionReceipt') {
                assert.deepEqual(params, [transactionHash]);
                return {...common, status:'0x1', logs};
            }
            assert.deepEqual(params[1], {blockHash, requireCanonical:true});
            if (method === 'eth_getCode') {
                assert.ok([core, nft].includes(params[0]));
                return params[0] === core ? '0x6001' : '0x6002';
            }
            assert.equal(method, 'eth_call');
            const {name, args} = abi.parseTransaction(params[0]);
            const coreReads = ['nft', 'protocolTreasury', 'ecosystemTreasury'];
            assert.equal(params[0].to, coreReads.includes(name) ? core : nft);
            if (args.length) assert.deepEqual([...args], [MaxUint256]);
            return abi.encodeFunctionResult(name, [values[name]]);
        };
        return Object.assign(send, {origin});
    }
    return { pair, location, provider, providers:[provider('https://one.invalid'), provider('https://two.invalid')] };
}

// Use both unmodified CLI branches with fake HTTPS transports and the local database.
async function checkResaleCommand(pool) {
    const f = resaleFixture(84);
    const dir = await mkdtemp(join(tmpdir(), 'artsoul-resale-'));
    const file = join(dir, 'pair.json');
    try {
        await writeFile(file, JSON.stringify(f.pair));
        const preload = `import {resaleFixture} from ${JSON.stringify(import.meta.url)};
            const f = resaleFixture(84);
            globalThis.fetch = async (url, request) => {
                const provider = f.providers.find(p => p.origin === new URL(url).origin);
                if (!provider) throw Error('Unexpected fixture request');
                const {method, params, id} = JSON.parse(request.body);
                const result = await provider(method, params);
                return Response.json({jsonrpc:'2.0', id, result});
            };`;
        const args = ['--import', 'data:text/javascript,' + encodeURIComponent(preload), 'scripts/read-ordinary-resale.mjs',
            file, String(f.location.blockNumber), f.location.blockHash, f.location.transactionHash, '1'];
        const env = {...process.env, ARTSOUL_ORDINARY_RPC_URL:f.providers[0].origin,
            ARTSOUL_ORDINARY_RPC_CHECK_URL:f.providers[1].origin, ARTSOUL_ORDINARY_DATABASE_URL:pool.options.connectionString};
        const command = (extra = [], options = env) => promisify(execFile)(process.execPath, [...args, ...extra],
            {env:options, windowsHide:true, timeout:15000});
        const count = async () => (await pool.query('SELECT count(*) FROM artsoul_private.ordinary_resale_purchases WHERE core_address=$1',
            [f.pair.coreAddress])).rows[0].count;
        assert.equal(JSON.parse((await command()).stdout).rpcReadings, 2);
        assert.equal(await count(), '0', 'a configured database alone does not enable writes');
        await assert.rejects(command(['--persist'], {...env, ARTSOUL_ORDINARY_DATABASE_URL:''}),
            error => error.code === 1 && error.stderr.includes('ARTSOUL_ORDINARY_DATABASE_URL'));
        await assert.rejects(command(['--other']), error => error.code === 1 && error.stderr.includes('Usage:'));
        assert.equal(JSON.parse((await command(['--persist'])).stdout).inserted, true);
        assert.equal(JSON.parse((await command(['--persist'])).stdout).inserted, false);
        assert.equal(await count(), '1');
    } finally {
        await unlink(file);
        await rmdir(dir);
    }
}

export async function checkOrdinaryResalePersistence(pool) {
    const { ingestOrdinaryResale } = await import('../../scripts/read-ordinary-resale.mjs');
    const ingest = (f, rpc = f.providers) => ingestOrdinaryResale(pool, f.pair, f.location, rpc);
    const first = resaleFixture(81), second = resaleFixture(82);
    const results = await Promise.all([ingest(first), ingest(first), ingest(second)]);
    assert.deepEqual(results.slice(0, 2).map(row => row.inserted).sort(), [false, true]);
    assert.equal(results[2].inserted, true);
    const rows = (await pool.query(`SELECT core_address,token_id,listing_version,artwork_id,price_wei,
        seller_wei,creator_wei,protocol_wei,ecosystem_wei FROM artsoul_private.ordinary_resale_purchases ORDER BY core_address`)).rows;
    assert.deepEqual(rows.map(row => Object.values(row)), [81, 82].map(id => [address(id),
        ...[MaxUint256, version, artwork, price, ...shares].map(String)]));
    const another = await ingest(resaleFixture(81, {logIndex:5}));
    assert.equal(another.inserted, true);
    assert.equal(another.sale.version, String(version + 1n));

    const alternate = [first.provider('https://one.invalid', address(11)), first.provider('https://two.invalid', address(11))];
    await assert.rejects(ingest(first, alternate), /Conflicting finalized evidence in ordinary_resale_purchases/);
    const unregistered = resaleFixture(83, first.location);
    await assert.rejects(ingest(unregistered), /Conflicting finalized evidence in ordinary_resale_purchases/);
    const noCheckout = {connect() { assert.fail('The database must not be contacted'); }};
    await assert.rejects(ingestOrdinaryResale(noCheckout, first.pair, first.location, [first.providers[0], alternate[1]]), /disagree/);
    await assert.rejects(ingestOrdinaryResale(noCheckout, first.pair, first.location, [alternate[0], alternate[0]]), /independent/);
    const changed = ingestOrdinaryResale(noCheckout, unregistered.pair, unregistered.location, unregistered.providers);
    unregistered.pair.expectedCoreCodeHash = hash(777);
    await assert.rejects(changed, /superseded/);
    assert.equal((await pool.query('SELECT count(*) FROM artsoul_private.ordinary_issuers WHERE core_address=$1',
        [address(83)])).rows[0].count, '0');
    assert.equal((await pool.query('SELECT count(*) FROM artsoul_private.ordinary_resale_purchases')).rows[0].count, '3');
    for (const command of ['DELETE FROM', 'UPDATE', 'TRUNCATE']) {
        const suffix = command === 'UPDATE' ? ' SET buyer=buyer' : '';
        await assert.rejects(pool.query(command + ' artsoul_private.ordinary_resale_purchases' + suffix), /append-only/);
    }
    await checkResaleCommand(pool);
}
