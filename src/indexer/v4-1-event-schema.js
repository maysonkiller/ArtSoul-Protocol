export const V41_CORE_ABI = [
    'event ArtworkRegistered(uint256 indexed artworkId, address indexed creator, string metadataURI)',
    'event AuctionCreated(uint256 indexed auctionId, uint256 indexed artworkId, address indexed creator, uint256 startPrice, uint256 duration, uint256 endTime, uint256 chainId)',
    'event BidPlaced(uint256 indexed auctionId, address indexed bidder, uint256 bidAmount, uint256 depositAmount)',
    'event BidDepositWithdrawn(uint256 indexed auctionId, address indexed bidder, uint256 amount)',
    'event AuctionExtended(uint256 indexed auctionId, uint256 oldEndTime, uint256 newEndTime)',
    'event AuctionEnded(uint256 indexed auctionId, address indexed winner, uint256 winningBid, uint256 settlementDeadline)',
    'event SettlementCompleted(uint256 indexed auctionId, uint256 indexed artworkId, address indexed winner, uint256 finalPrice, uint256 tokenId)',
    'event SettlementDefaulted(uint256 indexed auctionId, address indexed winner, uint256 artistAmount, uint256 platformAmount)',
    'event CanonicalFloorUpdated(uint256 indexed artworkId, uint256 indexed tokenId, uint256 floorPrice)',
    'event ResaleListed(uint256 indexed tokenId, address indexed seller, uint256 price)',
    'event ResaleCompleted(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price, uint256 royaltyAmount, uint256 platformFee)',
    'event ProjectNFTEligibilityAchieved(address indexed user, bytes32 eligibilityHash)',
    'event ProjectNFTMinted(address indexed user, uint256 indexed tokenId, bytes32 eligibilityHash)'
];

export const V41_EVENT_ARG_MAPPINGS = {
    ArtworkRegistered: ['artworkId', 'creator', 'metadataURI'],
    AuctionCreated: ['auctionId', 'artworkId', 'creator', 'startPrice', 'duration', 'endTime', 'chainId'],
    BidPlaced: ['auctionId', 'bidder', 'bidAmount', 'depositAmount'],
    BidDepositWithdrawn: ['auctionId', 'bidder', 'amount'],
    AuctionExtended: ['auctionId', 'oldEndTime', 'newEndTime'],
    AuctionEnded: ['auctionId', 'winner', 'winningBid', 'settlementDeadline'],
    SettlementCompleted: ['auctionId', 'artworkId', 'winner', 'finalPrice', 'tokenId'],
    SettlementDefaulted: ['auctionId', 'winner', 'artistAmount', 'platformAmount'],
    CanonicalFloorUpdated: ['artworkId', 'tokenId', 'floorPrice'],
    ResaleListed: ['tokenId', 'seller', 'price'],
    ResaleCompleted: ['tokenId', 'seller', 'buyer', 'price', 'royaltyAmount', 'platformFee'],
    ProjectNFTEligibilityAchieved: ['user', 'eligibilityHash'],
    ProjectNFTMinted: ['user', 'tokenId', 'eligibilityHash']
};

export const V41_EVENT_REQUIRED_FIELDS = Object.fromEntries(
    Object.entries(V41_EVENT_ARG_MAPPINGS).map(([eventName, fields]) => [eventName, fields])
);

export const V41_GLOBAL_STATS_EVENTS = new Set([
    'ArtworkRegistered',
    'AuctionCreated',
    'BidPlaced',
    'AuctionEnded',
    'SettlementCompleted',
    'SettlementDefaulted',
    'CanonicalFloorUpdated',
    'ResaleListed',
    'ResaleCompleted',
    'ProjectNFTEligibilityAchieved',
    'ProjectNFTMinted'
]);

export function isV41Event(eventName) {
    return Object.prototype.hasOwnProperty.call(V41_EVENT_ARG_MAPPINGS, eventName);
}

export function parseV41EventData(eventName, args) {
    const mapping = V41_EVENT_ARG_MAPPINGS[eventName];
    if (!mapping) {
        return {};
    }

    const parsed = {};
    for (let index = 0; index < mapping.length; index++) {
        const key = mapping[index];
        parsed[key] = args[key] !== undefined ? args[key] : args[index];
    }

    return parsed;
}

export function canonicalArtworkId(eventName, eventData) {
    if (eventData?.artworkId !== undefined && eventData.artworkId !== null) {
        return eventData.artworkId.toString();
    }

    if (eventName === 'SettlementDefaulted' || eventName === 'AuctionEnded') {
        return null;
    }

    return null;
}
