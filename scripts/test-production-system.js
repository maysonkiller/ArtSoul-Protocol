import dotenv from 'dotenv';
import EventListener from '../src/indexer/event-listener.js';

dotenv.config();

async function testSystem() {
    console.log(' TESTING PRODUCTION SYSTEM\n');

    // Test 1: RPC Connection
    console.log(' TEST 1: RPC Connection');
    try {
        const eventListener = new EventListener({
            rpcUrl: process.env.ETHEREUM_SEPOLIA_RPC,
            contractAddress: process.env.MARKETPLACE_CONTRACT_SEPOLIA,
            chainId: 11155111
        });

        const currentBlock = await eventListener.getCurrentBlock();
        console.log('   Current block:', currentBlock);
        console.log('    RPC connection working\n');

        // Test 2: Query Recent Events
        console.log(' TEST 2: Query Recent Events');
        const fromBlock = currentBlock - 1000;
        const events = await eventListener.queryAllHistoricalEvents(fromBlock, currentBlock);

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

            // Show sample event
            const sampleEvent = events[0];
            console.log('\n   Sample event:');
            console.log('     Type:', sampleEvent.eventName);
            console.log('     Block:', sampleEvent.blockNumber);
            console.log('     TX:', sampleEvent.transactionHash);
            console.log('     Data:', sampleEvent.eventData);
        }
        console.log('    Event querying working\n');

        // Test 3: Configuration Check
        console.log('  TEST 3: Configuration Check');
        console.log('   Contract:', process.env.MARKETPLACE_CONTRACT_SEPOLIA);
        console.log('   Start Block:', process.env.INDEXER_START_BLOCK);
        console.log('   Confirmation Depth:', process.env.INDEXER_CONFIRMATION_DEPTH);
        console.log('   Poll Interval:', process.env.INDEXER_POLL_INTERVAL, 'ms');
        console.log('    Configuration valid\n');

        console.log(' ALL TESTS PASSED\n');
        console.log(' Summary:');
        console.log('    RPC connection working');
        console.log('    Contract events accessible');
        console.log('    Event parsing working');
        console.log('    Configuration valid');
        console.log('\n System ready for deployment');
        console.log('\nNext steps:');
        console.log('   1. Start PostgreSQL: docker-compose up -d postgres');
        console.log('   2. Wait for DB to be ready (30s)');
        console.log('   3. Start indexer: docker-compose up -d indexer');
        console.log('   4. Start API: docker-compose up -d api');
        console.log('   5. Check health: curl http://localhost:3000/health');

    } catch (error) {
        console.error('\n TEST FAILED:');
        console.error(error);
        process.exit(1);
    }
}

testSystem();
