import {
    V41_CORE_ABI,
    V41_EVENT_ARG_MAPPINGS,
    V41_EVENT_REQUIRED_FIELDS,
    isV41Event
} from './v4-1-event-schema.js';

const requiredEvents = [
    'ArtworkRegistered',
    'AuctionCreated',
    'BidPlaced',
    'BidDepositWithdrawn',
    'AuctionExtended',
    'AuctionEnded',
    'SettlementCompleted',
    'SettlementDefaulted',
    'CanonicalFloorUpdated',
    'ResaleListed',
    'ResaleCompleted',
    'ProjectNFTEligibilityAchieved',
    'ProjectNFTMinted'
];

const missing = requiredEvents.filter(eventName => !isV41Event(eventName));
if (missing.length > 0) {
    throw new Error(`Missing V4.1 event mappings: ${missing.join(', ')}`);
}

for (const eventName of requiredEvents) {
    const fields = V41_EVENT_ARG_MAPPINGS[eventName];
    const required = V41_EVENT_REQUIRED_FIELDS[eventName];

    if (!Array.isArray(fields) || fields.length === 0) {
        throw new Error(`Event ${eventName} has no argument mapping`);
    }

    if (!Array.isArray(required) || required.join('|') !== fields.join('|')) {
        throw new Error(`Event ${eventName} required fields diverge from mapping`);
    }
}

console.log(`[V4.1 Indexer] Validated ${requiredEvents.length} canonical event mappings.`);
