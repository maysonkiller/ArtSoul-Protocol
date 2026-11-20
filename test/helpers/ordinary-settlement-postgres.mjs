import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Interface, ZeroAddress, keccak256, toQuantity } from 'ethers';
import EventListener from '../../src/indexer/event-listener.js';
import { ingestOrdinarySettlement } from '../../src/indexer/ordinary-settlement-intake.js';

const address = n => '0x' + n.toString(16).padStart(40, '0');
const hash = n => '0x' + n.toString(16).padStart(64, '0');
const abi = new Interface([
    'function nft() view returns (address)', 'function core() view returns (address)',
    'event AuctionSettled(uint256 indexed auctionId,uint256 indexed artworkId,uint256 tokenId,uint256 price)',
    'event SettledArtworkIssued(uint256 indexed auctionId,uint256 indexed artworkId,uint256 indexed tokenId,address creator,address firstCollector)',
    'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)'
]);

// A small in-process RPC serves real ABI-encoded logs to the unmodified receipt reader.
function fixture(pair, overrides = {}) {
    const core = address(pair), nft = address(pair + 10);
    const options = { chainId: 84532, coreAddress: core, nftAddress: nft, expectedCoreCodeHash: keccak256('0x6001'),
        expectedNftCodeHash: keccak256('0x6002'), blockNumber: pair, blockHash: hash(pair),
        transactionHash: hash(pair + 20), auctionId: '1', isCurrent: () => true, ...overrides.location };
    const { transactionHash, blockHash, auctionId, coreAddress, nftAddress } = options;
    const blockNumber = toQuantity(options.blockNumber);
    const creator = address(40), buyer = address(41), token = overrides.token || 1, artwork = overrides.artwork || 1;
    const log = (emitter, event, values, position) => ({
        address: emitter, logIndex: toQuantity(position), blockNumber, blockHash, transactionHash,
        ...abi.encodeEventLog(event, values)
    });
    const logs = [
        log(nftAddress, 'SettledArtworkIssued', [auctionId, artwork, token, creator, buyer], 0),
        log(nftAddress, 'Transfer', [ZeroAddress, buyer, token], 1),
        log(coreAddress, 'AuctionSettled', [auctionId, artwork, token, overrides.price || '1000000000000000001'], 2)
    ];
    const listener = Object.create(EventListener.prototype);
    Object.assign(listener, { chainId: options.chainId, contractAddress: coreAddress, nftAddress,
        _readRpcCall: async operation => operation({ send: async (method, args) => {
            if (method === 'eth_chainId') return toQuantity(options.chainId);
            if (method === 'eth_getBlockByNumber') return {
                number: args[0] === 'finalized' && overrides.unfinalized ? '0x0' : blockNumber, hash: blockHash
            };
            if (method === 'eth_getCode') return args[0] === coreAddress ? '0x6001' : '0x6002';
            if (method === 'eth_call') {
                const isCore = args[0].to === coreAddress;
                return abi.encodeFunctionResult(isCore ? 'nft' : 'core', [isCore ? nftAddress : coreAddress]);
            }
            assert.equal(method, 'eth_getTransactionReceipt');
            assert.equal(args[0], transactionHash);
            return { status: '0x1', blockNumber, blockHash, transactionHash, logs };
        } })
    });
    return { listener, options };
}

function intake(pool, pair, overrides) {
    const { listener, options } = fixture(pair, overrides);
    return ingestOrdinarySettlement(pool, listener, options);
}

async function verifyCommand(pool) {
    const { listener, options } = fixture(1);
    let rejectRead = false;
    const secret = 'private-rpc-path-fixture';
    const server = createServer(async (req, res) => {
        const chunks = [];
        for await (const part of req) chunks.push(part);
        const request = JSON.parse(Buffer.concat(chunks));
        const reply = async ({ id, method, params }) => rejectRead && method !== 'eth_chainId'
            ? { jsonrpc: '2.0', id, error: { code: -32000, message: secret } }
            : { jsonrpc: '2.0', id, result: await listener._readRpcCall(provider => provider.send(method, params)) };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(Array.isArray(request) ? await Promise.all(request.map(reply)) : await reply(request)));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const dir = await mkdtemp(join(tmpdir(), 'artsoul-ordinary-command-'));
    const pair = join(dir, 'pair.json'), locator = join(dir, 'receipt.json');
    const command = () => promisify(execFile)(process.execPath, ['scripts/index-ordinary-settlement.mjs', pair, locator], {
        windowsHide: true, timeout: 25000, env: { ...process.env, ARTSOUL_ORDINARY_RPC_URL: 'http://127.0.0.1:' + server.address().port + '/' + secret,
            ARTSOUL_ORDINARY_DATABASE_URL: 'postgresql://postgres@127.0.0.1:' + pool.options.port + '/postgres' }
    });
    try {
        const { chainId, coreAddress, nftAddress, expectedCoreCodeHash, expectedNftCodeHash, blockNumber, blockHash, transactionHash, auctionId } = options;
        await writeFile(pair, JSON.stringify({ chainId, coreAddress, nftAddress, expectedCoreCodeHash, expectedNftCodeHash }));
        await writeFile(locator, JSON.stringify({ blockNumber, blockHash, transactionHash, auctionId }));
        const { stdout } = await command();
        const report = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
        assert.equal(report.inserted, false);
        assert.equal(report.sale.priceWei, '1000000000000000001');
        assert.ok(!stdout.includes(secret));
        rejectRead = true;
        await assert.rejects(command, e => e.code === 1 && !e.stdout.includes(secret) && !e.stderr.includes(secret));
    } finally {
        await new Promise(resolve => server.close(resolve));
        await Promise.all([unlink(pair), unlink(locator)]);
        await rmdir(dir);
    }
}

export async function checkOrdinaryIntake(pool) {
    const results = await Promise.all([intake(pool, 1), intake(pool, 1), intake(pool, 2)]);
    assert.deepEqual(results.slice(0, 2).map(row => row.inserted).sort(), [false, true]);
    assert.equal(results[2].inserted, true);
    await assert.rejects(intake(pool, 1, { price: '1000000000000000002' }), /Conflicting finalized evidence/);
    await assert.rejects(intake(pool, 3, { location: { transactionHash: hash(21) } }), /Conflicting finalized evidence/);
    await assert.rejects(intake(pool, 3, { location: { nftAddress: address(11) } }), /Conflicting finalized evidence/);
    await assert.rejects(intake(pool, 1, { location: { auctionId: '2', blockNumber: 3, blockHash: hash(3), transactionHash: hash(23) }, artwork: 2 }), /Conflicting finalized evidence/);
    await assert.rejects(intake(pool, 3, { unfinalized: true }), /not finalized/);
    const rows = await pool.query(`SELECT core_address, nft_address, auction_id, price_wei FROM artsoul_private.ordinary_settlements
        JOIN artsoul_private.ordinary_issuers USING (chain_id, core_address) ORDER BY core_address`);
    assert.deepEqual(rows.rows, [1, 2].map(i => ({ core_address: address(i), nft_address: address(i + 10),
        auction_id: '1', price_wei: '1000000000000000001' })));
    assert.equal((await pool.query('SELECT count(*) FROM artsoul_private.ordinary_issuers')).rows[0].count, '2');
    await assert.rejects(pool.query('DELETE FROM artsoul_private.ordinary_settlements'), /append-only/);
    for (const table of ['ordinary_issuers', 'ordinary_settlements']) {
        const { rows: privileges } = await pool.query(`SELECT rolname, has_table_privilege(rolname, $1, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') AS permitted
            FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')`, ['artsoul_private.' + table]);
        assert.equal(privileges.length, 3);
        assert.ok(privileges.every(role => !role.permitted));
    }
    await verifyCommand(pool);
}
