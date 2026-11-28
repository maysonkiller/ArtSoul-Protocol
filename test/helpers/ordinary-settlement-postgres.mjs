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
import { syncOrdinaryHistory } from '../../scripts/sync-ordinary-history.mjs';
import { reportOrdinaryDemand } from '../../scripts/report-ordinary-demand.mjs';

const address = n => '0x' + n.toString(16).padStart(40, '0');
const hash = n => '0x' + n.toString(16).padStart(64, '0');
const abi = new Interface([
    'event ProceedsCredited(uint256 indexed auctionId,address indexed creator,address indexed treasury,uint256 creatorAmount,uint256 protocolAmount)',
    'function nft() view returns (address)', 'function core() view returns (address)', 'function totalSupply() view returns (uint256)',
    'function auctions(uint256) view returns(uint256,uint256,uint256,uint256,uint256,address,uint256,uint256,uint8,address)',
    'function runnerUpOffers(uint256) view returns(address,uint256,uint256)',
    'event RunnerUpOfferAccepted(uint256 indexed auctionId,address indexed bidder,uint256 price)',
    'event AuctionSettled(uint256 indexed auctionId,uint256 indexed artworkId,uint256 tokenId,uint256 price)',
    'event SettledArtworkIssued(uint256 indexed auctionId,uint256 indexed artworkId,uint256 indexed tokenId,address creator,address firstCollector)',
    'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
    'event ResalePurchased(uint256 indexed tokenId,uint256 version,address indexed seller,address indexed buyer,uint256 price)',
    'event ResaleCredited(uint256 indexed tokenId,uint256 indexed version,address protocol,address ecosystem,uint256,uint256,uint256,uint256)',
    'function tokenToArtwork(uint256) view returns(uint256)', 'function tokenCreator(uint256) view returns(address)',
    'function firstCollector(uint256) view returns(address)', 'function protocolTreasury() view returns(address)',
    'function ecosystemTreasury() view returns(address)'
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
        address: emitter, logIndex: toQuantity(position), transactionIndex: '0x0', blockNumber, blockHash, transactionHash,
        ...abi.encodeEventLog(event, values)
    });
    const firstIndex = stateOffer ? 1 : 0;
    const protocolShare = BigInt(price) / 40n + (BigInt(price) % 40n > 20n ? 1n : 0n);
    const logs = [
        log(coreAddress, 'ProceedsCredited', [auctionId, creator, address(46), BigInt(price) - protocolShare, protocolShare], firstIndex),
        log(nftAddress, 'SettledArtworkIssued', [auctionId, artwork, token, creator, buyer], firstIndex + 1),
        log(nftAddress, 'Transfer', [ZeroAddress, buyer, token], firstIndex + 2),
        log(coreAddress, 'AuctionSettled', [auctionId, artwork, token, price], firstIndex + 3)
    ];
    if (stateOffer && !overrides.omitAcceptance) logs.unshift(log(coreAddress, 'RunnerUpOfferAccepted', [auctionId, buyer, price], 0));
    let offerRead = false;
    const listener = Object.create(EventListener.prototype);
    Object.assign(listener, { chainId: options.chainId, contractAddress: coreAddress, nftAddress,
        _readRpcCall: async operation => operation({ send: async (method, args) => {
            if (method === 'eth_chainId') return toQuantity(options.chainId);
            if (method === 'eth_getBlockByNumber') return {
                number: args[0] === 'finalized' && overrides.unfinalized ? '0x0' : blockNumber,
                hash: offerRead && overrides.reorg ? hash(999) : blockHash, timestamp: toQuantity(overrides.timestamp ?? 16),
                transactions: [transactionHash]
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
            return { status: '0x1', blockNumber, blockHash, transactionHash, transactionIndex: '0x0', logs };
        } })
    });
    return { listener, options };
}

function intake(pool, pair, overrides) {
    const { listener, options } = fixture(pair, overrides);
    return ingestOrdinarySettlement(pool, listener, options);
}

export async function checkOrdinaryHistory(pool) {
    const { listener, options } = fixture(90);
    const raw = (method, args) => listener._readRpcCall(provider => provider.send(method, args));
    const receipt = await raw('eth_getTransactionReceipt', [options.transactionHash]);
    const { chainId, coreAddress, nftAddress, expectedCoreCodeHash, expectedNftCodeHash } = options;
    const pair = { chainId, coreAddress, nftAddress, expectedCoreCodeHash, expectedNftCodeHash };
    const origin = { fromBlock: 90, previousBlockHash: hash(89) };
    let head = 89, wrongPreviousOwner = false, badCredit = false, omitPurchase = false, wrongResaleCredit = false;
    function eventsAt(n) {
        if (n === 90) return receipt.logs.map(log => ({...log,removed:false}));
        function log(emitter, index, name, values) {
            return { address: emitter, removed:false, blockHash: hash(n), blockNumber: toQuantity(n),
                transactionHash: hash(n+20), transactionIndex:'0x0',logIndex:toQuantity(index),...abi.encodeEventLog(name,values) };
        }
        if (n === 91) return [log(nftAddress,2,'Transfer',[address(wrongPreviousOwner ? 43 : 41), address(42),1])];
        if (n === 93) return [log(coreAddress,1,'ResaleCredited',[1,1,address(46),address(47),185,11,wrongResaleCredit?3:2,2]),
            log(coreAddress,2,'ResalePurchased',[1,1,address(42),address(43),200]),log(nftAddress,3,'Transfer',[address(42),address(43),1])];
        return [];
    }
    const rpc = async (method, args) => {
        if (method === 'eth_getBlockByNumber') {
            const n = args[0] === 'finalized' ? head : Number(BigInt(args[0]));
            return { number: toQuantity(n), hash: hash(n), timestamp: '0x18', transactions: [hash(n+20)] };
        }
        if (method === 'eth_call' && args[0].data === abi.encodeFunctionData('totalSupply')) {
            return abi.encodeFunctionResult('totalSupply', [BigInt(args[1].blockHash) >= 90n ? 1 : 0]);
        }
        if (method === 'eth_getLogs') {
            const n = Number(BigInt(args[0].fromBlock));
            return eventsAt(n).filter(log => log.address===args[0].address && log.topics[0]===args[0].topics[0] &&
                !(omitPurchase && log.address===coreAddress));
        }
        if (method === 'eth_getTransactionReceipt') {
            const n = Number(BigInt(args[0]))-20;
            return { status:'0x1',blockHash:hash(n),blockNumber:toQuantity(n),transactionHash:args[0],transactionIndex:'0x0',
                logs: badCredit ? eventsAt(n).slice(1) : eventsAt(n) };
        }
        if (method === 'eth_call') {
            const name = abi.parseTransaction(args[0]).name;
            const fields = { tokenToArtwork:1, tokenCreator:address(40), firstCollector:address(41),
                protocolTreasury:address(46), ecosystemTreasury:address(47) };
            if (Object.hasOwn(fields,name)) return abi.encodeFunctionResult(name,[fields[name]]);
        }
        return raw(method, args);
    };
    const providers = [rpc, (method, args) => rpc(method, args)];
    const sync = (overrides = {}) => syncOrdinaryHistory({ pool, pair, origin, providers, maxBlocks: 1, ...overrides });
    const report = (first, last) => reportOrdinaryDemand(pool, String(chainId), coreAddress, String(first), String(last), { marketCoverage: true });
    const count = async table => Number((await pool.query('SELECT count(*) FROM artsoul_private.' + table +
        ' WHERE chain_id=$1 AND core_address=$2', [chainId,coreAddress])).rows[0].count);
    assert.equal((await sync()).status,'awaiting-first-range');
    head = 90;
    badCredit = true;
    await assert.rejects(sync(), /credit/);
    assert.equal(await count('ordinary_nft_ranges'), 0);
    assert.equal((await report(90,90)).primaryCoverage, 'incomplete');
    badCredit = false;
    assert.equal((await sync({ pool: undefined })).status, 'verified');
    assert.equal(await count('ordinary_nft_ranges'), 0);
    assert.equal((await sync({preview:true})).primarySales, 1);
    assert.equal(await count('ordinary_nft_ranges'), 0);
    const results = await Promise.allSettled([sync(),sync()]);
    assert.ok(results.some(result => result.status === 'fulfilled' && result.value.primarySales === 1));
    for (const result of results) if (result.status === 'rejected') assert.match(result.reason.message,/checkpoint changed/);
    assert.equal(await count('ordinary_settlements'), 1);
    assert.equal(await count('ordinary_primary_credits'), 1);
    assert.equal(await count('ordinary_nft_transfers'), 1);
    head = 92;
    wrongPreviousOwner = true;
    await assert.rejects(sync(), /preceding owner/);
    await assert.rejects(sync({preview:true}), /preceding owner/);
    assert.equal(await count('ordinary_nft_ranges'), 1, 'a failed ownership check rolls back its whole range');
    wrongPreviousOwner = false;
    const preview = await sync({preview:true});
    assert.equal(preview.status, 'verified');
    assert.equal(preview.fromBlock, 91);
    assert.equal(preview.previousBlockHash, hash(90));
    assert.equal(preview.transfers, 1);
    assert.equal(await count('ordinary_nft_ranges'), 1);
    assert.equal(await count('ordinary_nft_transfers'), 1);
    assert.equal((await sync()).throughBlock, 91);
    assert.equal((await sync()).transfers, 0);
    assert.equal((await sync()).status, 'caught-up');
    await assert.rejects(sync({ origin: { ...origin, fromBlock: 89 } }), /retained origin/);
    await assert.rejects(sync({ pair: { ...pair, nftAddress: address(501) } }), /reviewed pair/);
    assert.equal(await count('ordinary_nft_ranges'), 3);
    assert.equal(await count('ordinary_nft_transfers'), 2);
    assert.equal(await count('ordinary_settlements'), 1, 'a direct transfer does not create a sale');
    const verified = await report(90,92);
    assert.equal(verified.primaryCoverage, 'finalized_mints_and_credits');
    assert.equal(verified.coverage, 'indexed_receipts_only');
    assert.equal(verified.totals.primary_sales, '1');
    assert.equal(verified.totals.resales,'0');
    assert.equal(verified.coreResaleCoverage,'finalized_core_purchases_and_credits');
    assert.equal((await report(89,92)).primaryCoverage, 'incomplete');
    assert.equal((await report(90,93)).primaryCoverage, 'incomplete');
    assert.equal((await report(91,91)).totals.primary_sales, '0');
    const partial = await pool.connect();
    try {
        // Reproduce a partial restore in this transaction, then discard only its fixture rows.
        await partial.query('BEGIN');
        await partial.query(`INSERT INTO artsoul_private.ordinary_nft_ranges(chain_id,core_address,origin_block,
            origin_previous_hash,from_block,previous_hash,through_block,through_hash,supply_before,supply_after,event_count)
            VALUES ($1,$2,90,$3,94,$4,94,$5,1,1,0),($1,$2,90,$3,95,$5,95,$6,1,2,1)`,
        [chainId,coreAddress,hash(89),hash(93),hash(94),hash(95)]);
        const coverage = async (first,last) => (await reportOrdinaryDemand(partial,String(chainId),coreAddress,String(first),
            String(last),{ primaryCoverage: true })).primaryCoverage;
        assert.equal(await coverage(90,94), 'incomplete', 'a missing intervening range invalidates the requested coverage');
        assert.equal(await coverage(95,95), 'incomplete', 'a restored range without its mint cannot certify primary demand');
        assert.equal((await reportOrdinaryDemand(partial,String(chainId),coreAddress,'94','94',
            { marketCoverage: true })).coreResaleCoverage,'incomplete','a range without resale evidence cannot certify zero purchases');
    } finally {
        await partial.query('ROLLBACK');
        partial.release();
    }
    assert.equal((await pool.query(`SELECT to_wallet FROM artsoul_private.ordinary_nft_transfers WHERE core_address=$1
        ORDER BY block_number DESC LIMIT 1`, [coreAddress])).rows[0].to_wallet, address(42));
    head = 93;
    omitPurchase = true;
    await assert.rejects(sync(),/discovery differs from the transfer receipt/);
    omitPurchase = false;
    wrongResaleCredit = true;
    await assert.rejects(sync(),/Invalid ordinary resale credits/);
    assert.equal(await count('ordinary_nft_ranges'),3);
    wrongResaleCredit = false;
    assert.equal((await sync()).resales,1);
    const secondary = await report(90,93);
    assert.equal(secondary.coreResaleCoverage,'finalized_core_purchases_and_credits');
    assert.deepEqual([secondary.totals.resales,secondary.totals.resale_volume_wei,secondary.totals.resale_protocol_credit_wei,
        secondary.totals.resale_ecosystem_credit_wei],['1','200','2','2']);
    for (const table of ['ordinary_nft_ranges','ordinary_nft_transfers']) {
        const privileges = await pool.query(`SELECT has_table_privilege(rolname,$1,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS allowed
            FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')`, ['artsoul_private.' + table]);
        assert.equal(privileges.rowCount, 3);
        assert.ok(privileges.rows.every(role => !role.allowed));
        await assert.rejects(pool.query('DELETE FROM artsoul_private.' + table), /append-only/);
    }
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
    const fixtureUrl = 'http://127.0.0.1:' + server.address().port + '/' + secret;
    const settle = ['scripts/index-ordinary-settlement.mjs', pair, locator];
    const redirectFixture = 'const send=globalThis.fetch; globalThis.fetch=(url,options)=>send(' + JSON.stringify(fixtureUrl) + ',options);';
    const command = (args = settle, overrides = {}) => {
        const primary = args[0] === settle[0];
        const preload = primary ? ['--import','data:text/javascript,' + encodeURIComponent(redirectFixture)] : [];
        return promisify(execFile)(process.execPath, [...preload, ...args], {
            windowsHide: true, timeout: 25000, env: { ...process.env,
                ARTSOUL_ORDINARY_RPC_URL: primary ? 'https://primary.example' : fixtureUrl,
                ARTSOUL_ORDINARY_RPC_CHECK_URL: 'https://second.example',
                ARTSOUL_ORDINARY_DATABASE_URL: 'postgresql://postgres@127.0.0.1:' + pool.options.port + '/postgres', ...overrides }
        });
    };
    try {
        const { chainId, coreAddress, nftAddress, expectedCoreCodeHash, expectedNftCodeHash, blockNumber, blockHash, transactionHash, auctionId } = options;
        await writeFile(pair, JSON.stringify({ chainId, coreAddress, nftAddress, expectedCoreCodeHash, expectedNftCodeHash }));
        await writeFile(locator, JSON.stringify({ blockNumber, blockHash, transactionHash, auctionId }));
        const { stdout } = await command();
        const report = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
        assert.equal(report.inserted, false);
        assert.equal(report.sale.priceWei, '1000000000000000001');
        assert.equal(report.sale.rpcReadings, 2);
        const readOnly = await command([...settle,'--read-only'], {ARTSOUL_ORDINARY_DATABASE_URL:''});
        assert.deepEqual(JSON.parse(readOnly.stdout), {sale:report.sale});
        await assert.rejects(command(settle, {ARTSOUL_ORDINARY_RPC_CHECK_URL:'https://primary.example/another-path'}));
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
    // A settlement recorded before migration 023 must acquire its credit on replay.
    const older = fixture(2);
    const sale = await older.listener.readOrdinarySettlement(older.options);
    await pool.query(`INSERT INTO artsoul_private.ordinary_issuers(chain_id,core_address,nft_address,core_code_hash,nft_code_hash)
        VALUES ($1,$2,$3,$4,$5)`, [sale.chainId,sale.coreAddress,sale.nftAddress,sale.coreCodeHash,sale.nftCodeHash]);
    await pool.query(`INSERT INTO artsoul_private.ordinary_settlements(chain_id,core_address,auction_id,artwork_id,
        token_id,price_wei,creator,first_collector,runner_up_accepted,transaction_hash,block_number,block_hash,log_index)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [sale.chainId,sale.coreAddress,sale.auctionId,sale.artworkId,
        sale.tokenId,sale.priceWei,sale.creator,sale.firstCollector,sale.runnerUpAccepted,sale.transactionHash,sale.blockNumber,sale.blockHash,sale.logIndex]);
    const results = await Promise.all([intake(pool, 1), intake(pool, 1), intake(pool, 2)]);
    assert.deepEqual(results.slice(0, 2).map(row => row.inserted).sort(), [false, true]);
    assert.equal(results[2].inserted, false);
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
    const fees = await pool.query('SELECT core_address,protocol_treasury,protocol_wei,creator_wei FROM artsoul_private.ordinary_primary_credits ORDER BY core_address');
    assert.deepEqual(fees.rows, [1, 2, 3].map(i => ({core_address:address(i),protocol_treasury:address(46),
        protocol_wei:'25000000000000000',creator_wei:'975000000000000001'})));
    await assert.rejects(pool.query('DELETE FROM artsoul_private.ordinary_primary_credits'), /append-only/);
    for (const table of ['ordinary_issuers', 'ordinary_settlements','ordinary_primary_credits']) {
        const { rows: privileges } = await pool.query(`SELECT rolname, has_table_privilege(rolname, $1, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') AS permitted
            FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')`, ['artsoul_private.' + table]);
        assert.equal(privileges.length, 3);
        assert.ok(privileges.every(role => !role.permitted));
    }
    await verifyCommand(pool);
}
