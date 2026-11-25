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
import { ingestOrdinaryRunnerUpOffer } from '../../src/indexer/ordinary-runner-up-intake.js';

const address = n => '0x' + n.toString(16).padStart(40, '0');
const hash = n => '0x' + n.toString(16).padStart(64, '0');
const abi = new Interface([
    'function nft() view returns (address)', 'function core() view returns (address)',
    'function auctions(uint256) view returns(uint256,uint256,uint256,uint256,uint256,address,uint256,uint256,uint8,address)',
    'function runnerUpOffers(uint256) view returns(address,uint256,uint256)',
    'event RunnerUpOfferAccepted(uint256 indexed auctionId,address indexed bidder,uint256 price)',
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
    const price = overrides.price || '1000000000000000001';
    const stateOffer = overrides.offer === true;
    const log = (emitter, event, values, position) => ({
        address: emitter, logIndex: toQuantity(position), blockNumber, blockHash, transactionHash,
        ...abi.encodeEventLog(event, values)
    });
    const firstIndex = stateOffer ? 1 : 0;
    const logs = [
        log(nftAddress, 'SettledArtworkIssued', [auctionId, artwork, token, creator, buyer], firstIndex),
        log(nftAddress, 'Transfer', [ZeroAddress, buyer, token], firstIndex + 1),
        log(coreAddress, 'AuctionSettled', [auctionId, artwork, token, price], firstIndex + 2)
    ];
    if (stateOffer && !overrides.omitAcceptance) logs.unshift(log(coreAddress, 'RunnerUpOfferAccepted', [auctionId, buyer, price], 0));
    let offerRead = false;
    const listener = Object.create(EventListener.prototype);
    Object.assign(listener, { chainId: options.chainId, contractAddress: coreAddress, nftAddress,
        _readRpcCall: async operation => operation({ send: async (method, args) => {
            if (method === 'eth_chainId') return toQuantity(options.chainId);
            if (method === 'eth_getBlockByNumber') return {
                number: args[0] === 'finalized' && overrides.unfinalized ? '0x0' : blockNumber,
                hash: offerRead && overrides.reorg ? hash(999) : blockHash, timestamp: toQuantity(overrides.timestamp ?? 16)
            };
            if (method === 'eth_getCode') return args[0] === coreAddress ? '0x6001' : '0x6002';
            if (method === 'eth_call') {
                const isCore = args[0].to === coreAddress;
                if (isCore && args[0].data === abi.encodeFunctionData('auctions', [auctionId])) {
                    assert.deepEqual(args[1], {blockHash, requireCanonical:true});
                    return abi.encodeFunctionResult('auctions', [artwork,1,2,2,3,stateOffer ? address(42) : buyer,
                        stateOffer ? BigInt(price) + 1n : price,0,overrides.state ?? 4,buyer]);
                }
                if (isCore && args[0].data === abi.encodeFunctionData('runnerUpOffers', [auctionId])) {
                    offerRead = true;
                    assert.deepEqual(args[1], {blockHash, requireCanonical:true});
                    return abi.encodeFunctionResult('runnerUpOffers', [stateOffer ? buyer : address(42), price, stateOffer ? 16 : 0]);
                }
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
    const command = (args = ['scripts/index-ordinary-settlement.mjs', pair, locator]) => promisify(execFile)(process.execPath, args, {
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
        const privateOwner = address(70);
        await writeFile(pair, JSON.stringify({ chainId, adminSecurity: { owners: [privateOwner] },
            core: { address: coreAddress, codeHash: expectedCoreCodeHash }, nft: { address: nftAddress, codeHash: expectedNftCodeHash } }));
        const replay = await command();
        assert.deepEqual(JSON.parse(replay.stdout.trim().split(/\r?\n/).at(-1)), report);
        assert.ok(!replay.stdout.includes(privateOwner));
        const args = ['scripts/read-ordinary-runner-up.mjs', pair, auctionId, String(blockNumber), blockHash];
        const observation = () => pool.query('SELECT 1 FROM artsoul_private.ordinary_runner_up_observations WHERE core_address=$1', [coreAddress]);
        const dry = await command(args);
        assert.equal(JSON.parse(dry.stdout.trim().split(/\r?\n/).at(-1)).status, 'not_offered');
        assert.equal((await observation()).rowCount, 0, 'a configured database alone never enables persistence');
        const stored = await command([...args, '--persist']);
        assert.equal(JSON.parse(stored.stdout.trim().split(/\r?\n/).at(-1)).changed, true);
        assert.equal((await observation()).rowCount, 1);
        rejectRead = true;
        await assert.rejects(command, e => e.code === 1 && !e.stdout.includes(secret) && !e.stderr.includes(secret));
    } finally {
        await new Promise(resolve => server.close(resolve));
        await Promise.all([unlink(pair), unlink(locator)]);
        await rmdir(dir);
    }
}

export async function checkRunnerUpIntake(pool) {
    const observe = (pair, height, overrides = {}) => {
        const { listener, options } = fixture(pair, { ...overrides,
            location: { blockNumber: height, blockHash: hash(height), ...overrides.location } });
        return ingestOrdinaryRunnerUpOffer(pool, listener, options);
    };
    const open = { offer:true, state:6 };
    const results = await Promise.all([observe(61, 100, open), observe(61, 100, open), observe(62, 100, open)]);
    assert.deepEqual(results.slice(0, 2).map(result => result.changed).sort(), [false, true]);
    assert.equal(results[2].offer.priceWei, '1000000000000000001');
    await assert.rejects(observe(61, 99, open), /Stale runner-up/);
    await assert.rejects(observe(61, 100, { ...open, location:{blockHash:hash(111)} }), /Conflicting runner-up/);
    await assert.rejects(observe(61, 100, { ...open, price:'1000000000000000002' }), /Conflicting runner-up/);
    await assert.rejects(observe(61, 101, { ...open, price:'1000000000000000002' }), /Inconsistent runner-up/);
    await assert.rejects(observe(61, 101, { ...open, artwork:2 }), /Inconsistent runner-up/);
    await assert.rejects(observe(63, 101, { ...open, reorg:true }), /canonical block mismatch/);
    await assert.rejects(observe(63, 101, { ...open, unfinalized:true }), /not finalized/);
    assert.equal((await observe(61, 101, { ...open, timestamp:17 })).offer.status, 'expired');
    await assert.rejects(observe(61, 102, open), /Inconsistent runner-up/);
    assert.equal((await observe(61, 102, { ...open, state:5, timestamp:18 })).offer.status, 'closed');
    assert.equal((await observe(62, 101, { ...open, state:4 })).offer.status, 'accepted');
    const stored = await pool.query(`SELECT core_address, status, block_number, price_wei FROM artsoul_private.ordinary_runner_up_observations
        WHERE core_address IN ($1,$2,$3) ORDER BY core_address`, [address(61), address(62), address(63)]);
    assert.deepEqual(stored.rows.map(row => [row.core_address, row.status, row.block_number, row.price_wei]), [
        [address(61),'closed','102','1000000000000000001'], [address(62),'accepted','101','1000000000000000001']
    ]);
    const table = 'artsoul_private.ordinary_runner_up_observations';
    const roles = await pool.query(`SELECT has_table_privilege(rolname, $1, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') AS allowed
        FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')`, [table]);
    assert.equal(roles.rowCount, 3);
    assert.ok(roles.rows.every(row => !row.allowed));
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
    assert.equal((await pool.query('SELECT count(*) FROM artsoul_private.ordinary_issuers WHERE chain_id=84532')).rows[0].count, '2');
    await assert.rejects(intake(pool, 3, {offer:true, omitAcceptance:true}), /finalized auction state disagree/);
    await assert.rejects(intake(pool, 3, {offer:true, reorg:true}), /canonical block mismatch/);
    const count = async table => (await pool.query(`SELECT count(*) FROM artsoul_private.${table} WHERE core_address=$1`, [address(3)])).rows[0].count;
    assert.equal(await count('ordinary_issuers'), '0');
    assert.equal(await count('ordinary_settlements'), '0');
    const offerSale = await intake(pool, 3, {offer:true});
    assert.equal(offerSale.inserted, true);
    const stored = await pool.query('SELECT runner_up_accepted,price_wei,first_collector FROM artsoul_private.ordinary_settlements WHERE core_address=$1', [address(3)]);
    assert.deepEqual(stored.rows, [{runner_up_accepted:true,price_wei:'1000000000000000001',first_collector:address(41)}]);
    await assert.rejects(pool.query('DELETE FROM artsoul_private.ordinary_settlements'), /append-only/);
    for (const table of ['ordinary_issuers', 'ordinary_settlements']) {
        const { rows: privileges } = await pool.query(`SELECT rolname, has_table_privilege(rolname, $1, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') AS permitted
            FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')`, ['artsoul_private.' + table]);
        assert.equal(privileges.length, 3);
        assert.ok(privileges.every(role => !role.permitted));
    }
    await verifyCommand(pool);
}
