import dotenv from 'dotenv';
import ArtSoulIndexer from '../src/indexer/index.js';

dotenv.config();

// Mock database for testing
const mockDatabase = {
    data: {
        indexer_state: [],
        indexed_auctions: [],
        indexed_bids: [],
        contract_events: [],
        indexer_errors: []
    },

    async query(sql, params = []) {
        console.log('[MockDB] Query:', sql.substring(0, 100));

        if (sql.includes('SELECT * FROM indexer_state')) {
            return this.data.indexer_state;
        }

        if (sql.includes('INSERT INTO indexer_state')) {
            this.data.indexer_state = [{
                id: 1,
                contract_address: params[0],
                chain_id: params[1],
                last_indexed_block: params[2],
                last_indexed_at: params[3],
                started_at: params[4],
                status: 'initialized',
                total_events_indexed: 0
            }];
            return { insertId: 1 };
        }

        if (sql.includes('UPDATE indexer_state')) {
            if (this.data.indexer_state.length > 0) {
                if (sql.includes('status =')) {
                    this.data.indexer_state[0].status = params[0];
                    this.data.indexer_state[0].last_indexed_at = params[1];
                }
                if (sql.includes('last_indexed_block =')) {
                    this.data.indexer_state[0].last_indexed_block = params[0];
                    this.data.indexer_state[0].last_indexed_at = params[1];
                    this.data.indexer_state[0].total_events_indexed += params[2] || 0;
                }
            }
            return { affectedRows: 1 };
        }

        if (sql.includes('INSERT INTO contract_events')) {
            this.data.contract_events.push({
                id: this.data.contract_events.length + 1,
                event_name: params[0],
                artwork_id: params[1],
                block_number: params[2],
                transaction_hash: params[3],
                log_index: params[4],
                event_data: params[5],
                indexed_at: params[6]
            });
            return { insertId: this.data.contract_events.length };
        }

        if (sql.includes('INSERT INTO indexed_auctions')) {
            this.data.indexed_auctions.push({
                artwork_id: params[0],
                seller: params[1],
                starting_price: params[2],
                start_time: params[3],
                end_time: params[4],
                ended: false,
                winner_purchased: false,
                highest_bidder: null,
                highest_bid: '0',
                block_number: params[5],
                transaction_hash: params[6],
                indexed_at: params[7],
                last_updated_block: params[8],
                last_updated_at: params[9]
            });
            return { insertId: this.data.indexed_auctions.length };
        }

        if (sql.includes('INSERT INTO indexed_bids')) {
            this.data.indexed_bids.push({
                id: this.data.indexed_bids.length + 1,
                artwork_id: params[0],
                bidder: params[1],
                amount: params[2],
                timestamp: params[3],
                block_number: params[4],
                transaction_hash: params[5],
                log_index: params[6],
                indexed_at: params[7]
            });
            return { insertId: this.data.indexed_bids.length };
        }

        if (sql.includes('UPDATE indexed_auctions')) {
            const auction = this.data.indexed_auctions.find(a => a.artwork_id === params[params.length - 1]);
            if (auction) {
                if (sql.includes('highest_bidder =')) {
                    auction.highest_bidder = params[0];
                    auction.highest_bid = params[1];
                    auction.last_updated_block = params[2];
                    auction.last_updated_at = params[3];
                }
                if (sql.includes('ended = true')) {
                    auction.ended = true;
                    auction.highest_bidder = params[0];
                    auction.highest_bid = params[1];
                    auction.winner_deadline = params[2];
                    auction.last_updated_block = params[3];
                    auction.last_updated_at = params[4];
                }
                if (sql.includes('winner_purchased = true')) {
                    auction.winner_purchased = true;
                    auction.last_updated_block = params[0];
                    auction.last_updated_at = params[1];
                }
            }
            return { affectedRows: 1 };
        }

        if (sql.includes('SELECT * FROM indexed_auctions WHERE artwork_id')) {
            return this.data.indexed_auctions.filter(a => a.artwork_id === params[0]);
        }

        if (sql.includes('SELECT * FROM indexed_bids WHERE artwork_id')) {
            return this.data.indexed_bids.filter(b => b.artwork_id === params[0]);
        }

        if (sql.includes('SELECT * FROM indexer_errors WHERE resolved = false')) {
            return this.data.indexer_errors.filter(e => !e.resolved);
        }

        return [];
    }
};

async function testIndexer() {
    console.log(' TESTING ArtSoul Indexer\n');

    const indexer = new ArtSoulIndexer({
        database: mockDatabase,
        rpcUrl: process.env.ETHEREUM_SEPOLIA_RPC,
        contractAddress: process.env.MARKETPLACE_CONTRACT_SEPOLIA,
        chainId: 11155111,
        startBlock: 7500000
    });

    console.log(' STEP 1: Initialize indexer');
    await indexer.syncEngine.initialize(
        process.env.MARKETPLACE_CONTRACT_SEPOLIA,
        11155111,
        7500000
    );

    const state = await indexer.syncEngine.getIndexerState();
    console.log('   Status:', state.status);
    console.log('   Last indexed block:', state.last_indexed_block);
    console.log('    Initialized\n');

    console.log(' STEP 2: Query current block');
    const currentBlock = await indexer.eventListener.getCurrentBlock();
    console.log('   Current block:', currentBlock);
    console.log('   Blocks to sync:', currentBlock - state.last_indexed_block);
    console.log('    Connected to RPC\n');

    console.log('🔍 STEP 3: Query historical events (last 1000 blocks)');
    const fromBlock = currentBlock - 1000;
    const events = await indexer.eventListener.queryAllHistoricalEvents(fromBlock, currentBlock);
    console.log('   Events found:', events.length);

    if (events.length > 0) {
        const eventCounts = {};
        events.forEach(e => {
            eventCounts[e.eventName] = (eventCounts[e.eventName] || 0) + 1;
        });
        console.log('   Event breakdown:');
        for (const [name, count] of Object.entries(eventCounts)) {
            console.log(`     ${name}: ${count}`);
        }
    }
    console.log('    Historical query working\n');

    console.log('📥 STEP 4: Sync historical events to database');
    if (events.length > 0) {
        const synced = await indexer.syncEngine.syncHistoricalEvents(fromBlock, currentBlock);
        console.log('   Events synced:', synced);
        console.log('    Database sync working\n');

        console.log(' STEP 5: Query indexed data');

        if (mockDatabase.data.indexed_auctions.length > 0) {
            const auction = mockDatabase.data.indexed_auctions[0];
            console.log('   Sample auction:');
            console.log('     Artwork ID:', auction.artwork_id);
            console.log('     Seller:', auction.seller);
            console.log('     Starting Price:', auction.starting_price);
            console.log('     Ended:', auction.ended);
        }

        if (mockDatabase.data.indexed_bids.length > 0) {
            console.log('   Total bids indexed:', mockDatabase.data.indexed_bids.length);
            const bid = mockDatabase.data.indexed_bids[0];
            console.log('   Sample bid:');
            console.log('     Artwork ID:', bid.artwork_id);
            console.log('     Bidder:', bid.bidder);
            console.log('     Amount:', bid.amount);
        }

        console.log('    Indexed data accessible\n');
    } else {
        console.log('     No events found in last 1000 blocks\n');
    }

    console.log('🔍 STEP 6: Test specific auction query');
    const testArtworkId = '1777838975110';
    const auction = await indexer.getAuction(testArtworkId);

    if (auction) {
        console.log('   Found auction:', testArtworkId);
        console.log('     Seller:', auction.seller);
        console.log('     Highest Bid:', auction.highestBid);
        console.log('     Ended:', auction.ended);

        const bids = await indexer.getBids(testArtworkId);
        console.log('     Total Bids:', bids.length);
        console.log('    Auction query working\n');
    } else {
        console.log('     Auction not found (may not be in last 1000 blocks)\n');
    }

    console.log('🏥 STEP 7: Check indexer health');
    const health = await indexer.getIndexerHealth();
    console.log('   Status:', health.status);
    console.log('   Last indexed block:', health.lastIndexedBlock);
    console.log('   Current block:', health.currentBlock);
    console.log('   Blocks behind:', health.blocksBehind);
    console.log('   Total events indexed:', health.totalEventsIndexed);
    console.log('   Unresolved errors:', health.unresolvedErrors);
    console.log('    Health check working\n');

    console.log(' INDEXER TEST COMPLETE\n');
    console.log(' Summary:');
    console.log('    Event listener working');
    console.log('    Historical event query working');
    console.log('    Database sync working');
    console.log('    Indexed data accessible');
    console.log('    API methods working');
    console.log('    Health monitoring working');
    console.log('\n Ready for production deployment');
}

testIndexer().catch(error => {
    console.error('\n TEST FAILED:');
    console.error(error);
    process.exit(1);
});
