import { DatabaseSync } from 'node:sqlite';
import { Interface, ZeroAddress, ZeroHash, getAddress, isHexString } from 'ethers';

// Only events that change the next permissionless action or its deadline.
const events = new Interface([
    'event AuctionOpened(uint256 indexed auctionId,uint256 indexed artworkId,uint256 startPrice,uint256 end)',
    'event BidAccepted(uint256 indexed auctionId,address indexed bidder,uint256 price,uint256 deposit)',
    'event AuctionExtended(uint256 indexed auctionId,uint256 oldEnd,uint256 newEnd)',
    'event AuctionClosed(uint256 indexed auctionId,address indexed winner,uint256 deadline)',
    'event AuctionSettled(uint256 indexed auctionId,uint256 indexed artworkId,uint256 tokenId,uint256 price)',
    'event AuctionDefaulted(uint256 indexed auctionId,address indexed winner,uint256 deposit)',
    'event RunnerUpOfferOpened(uint256 indexed auctionId,address indexed bidder,uint256 price,uint256 deadline)',
    'event RunnerUpOfferDeclined(uint256 indexed auctionId,address indexed bidder)',
    'event RunnerUpOfferExpired(uint256 indexed auctionId,address indexed bidder)'
]);
const topics = events.fragments.map(event => event.topicHash);
const EMPTY_CHECKPOINT_INTERVAL = 20_000;

function integer(value, name, min = 0, max = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid ' + name);
    return value;
}
function blockHash(hash) {
    if (!isHexString(hash, 32) || hash.toLowerCase() === ZeroHash) throw new Error('Invalid block or code hash');
    return hash.toLowerCase();
}
async function header(provider, height) {
    const block = await provider.getBlock(height);
    if (block?.number !== height) throw new Error('Missing keeper checkpoint header');
    return { height, hash: blockHash(block.hash), timestamp: integer(block.timestamp, 'block timestamp') };
}

export function openKeeperStore(filename, { chainId, engine, codeHash, startBlock }) {
    const scope = [integer(Number(chainId), 'chain ID', 1), getAddress(engine), blockHash(codeHash),
        integer(startBlock, 'deployment block')];
    if (scope[1] === ZeroAddress) throw new Error('Invalid engine address');
    const db = new DatabaseSync(filename);
    let persisted;
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS checkpoint (
                singleton INTEGER PRIMARY KEY CHECK(singleton=1), chain INTEGER NOT NULL, engine TEXT NOT NULL,
                code_hash TEXT NOT NULL, origin INTEGER NOT NULL, height INTEGER NOT NULL, hash TEXT
            );
            CREATE TABLE IF NOT EXISTS rounds (
                id TEXT PRIMARY KEY, action TEXT NOT NULL, due INTEGER NOT NULL, eligible INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS keeper_ready ON rounds(eligible,id) WHERE action <> 'unfunded';
            CREATE INDEX IF NOT EXISTS keeper_unfunded ON rounds(due) WHERE action = 'unfunded';
        `);
        persisted = db.prepare('SELECT * FROM checkpoint WHERE singleton=1').get();
        if (!persisted) {
            db.prepare('INSERT INTO checkpoint VALUES (1,?,?,?,?,?,NULL)').run(...scope, startBlock - 1);
            persisted = { height: startBlock - 1, hash: null };
        } else if ([persisted.chain, persisted.engine, persisted.code_hash, persisted.origin]
            .some((value, index) => value !== scope[index])) {
            throw new Error('Keeper database belongs to a different deployment');
        }
    } catch (error) {
        db.close();
        throw error;
    }

    const insert = db.prepare('INSERT INTO rounds (id,action,due,eligible) VALUES (?,?,?,?)');
    const fund = db.prepare("UPDATE rounds SET action='closeAuction' WHERE id=? AND action='unfunded'");
    const funded = db.prepare("SELECT 1 FROM rounds WHERE id=? AND action='closeAuction'");
    const update = db.prepare('UPDATE rounds SET due=?, eligible=? WHERE id=?');
    const payment = db.prepare("UPDATE rounds SET action='finalizeDefault', due=?, eligible=? WHERE id=?");
    const remove = db.prepare('DELETE FROM rounds WHERE id=?');
    const findExpired = db.prepare("SELECT 1 FROM rounds WHERE action='unfunded' AND due<=? LIMIT 1");
    const prune = db.prepare("DELETE FROM rounds WHERE action='unfunded' AND due<=?");
    const checkpoint = db.prepare('UPDATE checkpoint SET height=?, hash=? WHERE singleton=1 AND height=? AND hash IS ?');
    const select = db.prepare(`SELECT id, action, due FROM rounds WHERE action <> 'unfunded' AND eligible<=?
        ORDER BY eligible,id LIMIT ?`);
    const defer = db.prepare(`UPDATE rounds SET eligible=? WHERE id=? AND action <> 'unfunded' AND eligible<?`);
    let cursor = { height: persisted.height, hash: persisted.hash };
    let active = false;

    function apply(event) {
        const id = String(event.args.auctionId);
        if (event.name === 'AuctionOpened') {
            const end = integer(Number(event.args.end), 'auction end');
            insert.run(id, 'unfunded', end, end);
        } else if (event.name === 'BidAccepted') {
            if (!fund.run(id).changes && !funded.get(id)) throw new Error('Missing auction for bid');
        } else if (event.name === 'AuctionExtended') {
            const end = integer(Number(event.args.newEnd), 'extended end');
            if (!update.run(end, end, id).changes) throw new Error('Missing auction for extension');
        } else if (event.name === 'AuctionClosed' && event.args.winner !== ZeroAddress) {
            const due = integer(Number(event.args.deadline) + 1, 'first default second');
            if (!payment.run(due, due, id).changes) throw new Error('Missing funded auction history');
        } else if (event.name === 'RunnerUpOfferOpened') {
            const due = integer(Number(event.args.deadline) + 1, 'first expiry second');
            insert.run(id, 'expireRunnerUpOffer', due, due);
        } else {
            remove.run(id);
        }
    }

    // Match the durable cursor in the same SQLite transaction as all derived changes.
    function persist(next, parsed, expired) {
        db.exec('BEGIN IMMEDIATE');
        try {
            const result = checkpoint.run(next.height, next.hash, persisted.height, persisted.hash);
            if (!result.changes) throw new Error('Another worker advanced the keeper database');
            for (const event of parsed) apply(event);
            if (expired || parsed.length) prune.run(next.timestamp);
            db.exec('COMMIT');
            persisted = { height: next.height, hash: next.hash };
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    }

    async function sync(provider, tipNumber, { blockRange = 1000, maxRanges = 2 } = {}) {
        integer(tipNumber, 'confirmed tip');
        integer(blockRange, 'log range', 1, 5000);
        integer(maxRanges, 'ranges per cycle', 1, 10);
        if (active) throw new Error('Keeper discovery already running');
        active = true;
        try {
            if (cursor.hash) {
                if (tipNumber < cursor.height) throw new Error('Confirmed tip behind keeper checkpoint');
                if ((await header(provider, cursor.height)).hash !== cursor.hash) {
                    throw new Error('Keeper checkpoint changed; rebuild from reviewed deployment block');
                }
            }
            for (let range = 0; range < maxRanges && cursor.height < tipNumber; range++) {
                const from = cursor.height + 1;
                const to = Math.min(tipNumber, cursor.height + blockRange);
                const before = await header(provider, to);
                const logs = await provider.getLogs({ address: scope[1], topics: [topics], fromBlock: from, toBlock: to });
                const ordered = [...logs].sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
                const parsed = [];
                let previousHeight = -1, expectedHash, previousIndex;
                for (const log of ordered) {
                    integer(log.blockNumber, 'log block', from, to);
                    integer(log.index, 'log index');
                    if (getAddress(log.address) !== scope[1] || log.removed) throw new Error('Invalid keeper log origin');
                    if (log.blockNumber !== previousHeight) {
                        previousHeight = log.blockNumber;
                        previousIndex = -1;
                        expectedHash = previousHeight === to ? before.hash : (await header(provider, previousHeight)).hash;
                    }
                    if (log.index <= previousIndex || expectedHash !== blockHash(log.blockHash)) {
                        throw new Error('Duplicate or noncanonical keeper log');
                    }
                    previousIndex = log.index;
                    const event = events.parseLog(log);
                    if (!event) throw new Error('Unexpected keeper event');
                    parsed.push(event);
                }
                if ((await header(provider, to)).hash !== before.hash ||
                    (cursor.hash && (await header(provider, cursor.height)).hash !== cursor.hash)) {
                    throw new Error('Keeper log range changed');
                }
                const expired = Boolean(findExpired.get(before.timestamp));
                if (parsed.length || expired || to - persisted.height >= EMPTY_CHECKPOINT_INTERVAL) {
                    persist(before, parsed, expired);
                }
                cursor = before;
            }
            return { through: cursor.height, caughtUp: cursor.height >= tipNumber };
        } catch (error) {
            // Never flush a volatile empty range after its provider or hash failed validation.
            cursor = { height: persisted.height, hash: persisted.hash };
            throw error;
        } finally {
            active = false;
        }
    }
    return {
        sync,
        ready(timestamp, limit) {
            integer(timestamp, 'due timestamp');
            integer(limit, 'due limit', 1, 1000);
            return select.all(timestamp, limit).map(row => ({ id: BigInt(row.id), action: row.action, dueAt: row.due }));
        },
        postpone(id, nextTimestamp) {
            integer(nextTimestamp, 'retry timestamp');
            defer.run(nextTimestamp, String(id), nextTimestamp);
        },
        close() {
            if (active) throw new Error('Keeper discovery is still running');
            try {
                if (cursor.height !== persisted.height) persist(cursor, [], false);
            } finally {
                db.close();
            }
        }
    };
}
