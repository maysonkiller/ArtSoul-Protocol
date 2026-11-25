import assert from 'node:assert/strict';
import { AbiCoder, Interface, MaxUint256, toQuantity } from 'ethers';
import { ingestOrdinaryReceipt } from '../../scripts/read-ordinary-receipt.mjs';
import { resaleFixture } from './ordinary-resale-postgres.mjs';

const abi = new Interface([
    'event ArtworkRegistered(uint256 indexed artworkId,address indexed creator,string metadataURI)',
    'function works(uint256) view returns (address,bytes,uint256,uint256)'
]);
const creator = '0x' + '5'.repeat(40);

// Reuse the ordinary pair's two finalized RPC fixtures. Only the event and works() differ.
export function registrationFixture(id, options = {}) {
    const f = resaleFixture(id, {logIndex:0, ...options.location});
    const {location, pair} = f;
    const metadata = options.metadata ?? '0x6100ff';
    const common = {transactionHash:location.transactionHash, transactionIndex:'0x0',
        blockNumber:toQuantity(location.blockNumber), blockHash:location.blockHash};
    const log = { ...common, address:pair.coreAddress, logIndex:toQuantity(location.logIndex),
        topics:abi.encodeFilterTopics('ArtworkRegistered', [MaxUint256, creator]),
        data:AbiCoder.defaultAbiCoder().encode(['bytes'], [metadata]) };
    const providers = f.providers.map(base => Object.assign(async (method, params) => {
        if (method === 'eth_getTransactionReceipt') {
            assert.deepEqual(params, [location.transactionHash]);
            return {...common, status:'0x1', logs: options.logs?.(structuredClone(log)) ?? [log]};
        }
        if (method === 'eth_call' && params[0].data === abi.encodeFunctionData('works', [MaxUint256])) {
            assert.equal(params[0].to, pair.coreAddress);
            assert.deepEqual(params[1], {blockHash:location.blockHash, requireCanonical:true});
            return abi.encodeFunctionResult('works', [creator, options.workMetadata ?? metadata, 17n, 0n]);
        }
        return base(method, params);
    }, {origin:base.origin}));
    return {pair, location, providers};
}

export async function checkOrdinaryRegistrationIntake(pool) {
    const ingest = f => ingestOrdinaryReceipt('registration', pool, f.pair, f.location, f.providers);
    const first = registrationFixture(91), second = registrationFixture(92);
    const before = (await pool.query('SELECT * FROM public.indexer_state ORDER BY chain_id')).rows;
    const outcomes = await Promise.all([ingest(first), ingest(first), ingest(second)]);
    assert.deepEqual(outcomes.slice(0,2).map(o => o.inserted).sort(), [false, true]);
    assert.equal(outcomes[2].inserted, true);
    await assert.rejects(ingest(registrationFixture(91, {metadata:'0x62'})), /Conflicting finalized evidence/);
    await assert.rejects(ingest(registrationFixture(93, {location:first.location})), /Conflicting finalized evidence/);
    assert.equal((await pool.query('SELECT count(*) FROM artsoul_private.ordinary_issuers WHERE core_address=$1',
        [registrationFixture(93).pair.coreAddress])).rows[0].count, '0');
    const rows = await pool.query(`SELECT core_address, artwork_id, encode(metadata_uri,'hex') AS uri, log_index
        FROM artsoul_private.ordinary_registrations WHERE chain_id=84532 ORDER BY core_address`);
    assert.deepEqual(rows.rows, [first, second].map(f => ({core_address:f.pair.coreAddress, artwork_id:String(MaxUint256), uri:'6100ff', log_index:'0'})));
    for (const sql of ['UPDATE artsoul_private.ordinary_registrations SET creator=creator',
        'DELETE FROM artsoul_private.ordinary_registrations', 'TRUNCATE artsoul_private.ordinary_registrations']) {
        await assert.rejects(pool.query(sql), /append-only/);
    }
    const roles = await pool.query(`SELECT has_table_privilege(rolname,'artsoul_private.ordinary_registrations',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS allowed FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')`);
    assert.equal(roles.rowCount, 3);
    assert.ok(roles.rows.every(row => !row.allowed));
    assert.deepEqual((await pool.query('SELECT * FROM public.indexer_state ORDER BY chain_id')).rows, before);
}
