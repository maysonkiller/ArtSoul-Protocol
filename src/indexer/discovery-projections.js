const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function toNumber(value, fallback = 0) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeAddress(address) {
    return (address || '').toString().toLowerCase();
}

function ensureUser(map, address) {
    const key = normalizeAddress(address);
    if (!key || key === ZERO_ADDRESS) return null;

    if (!map.has(key)) {
        map.set(key, {
            address: key,
            auctionParticipations: 0,
            successfulSettlements: 0,
            failedSettlements: 0,
            artworkUploads: 0,
            artworkInteractions: 0,
            genesisOwned: false,
            suspiciousFlags: 0
        });
    }

    return map.get(key);
}

export function computeTrustWeight(signal = {}) {
    let score = 45;
    score += Math.min(toNumber(signal.artworkUploads), 6) * 2;
    score += Math.min(toNumber(signal.auctionParticipations), 10) * 1.5;
    score += Math.min(toNumber(signal.successfulSettlements), 5) * 8;
    score += Math.min(toNumber(signal.artworkInteractions), 20) * 0.5;
    score += signal.genesisOwned ? 10 : 0;
    score -= Math.min(toNumber(signal.failedSettlements), 5) * 6;
    score -= Math.min(toNumber(signal.suspiciousFlags), 4) * 8;

    const normalized = Math.max(5, Math.min(100, Math.round(score)));
    return {
        score: normalized,
        influenceWeight: Number((0.25 + normalized / 100).toFixed(2)),
        tier: normalized >= 80 ? 'High trust' : normalized >= 60 ? 'Established' : normalized < 30 ? 'Low signal' : 'Building'
    };
}

export function buildTrustProjection(events = [], externalSignals = {}) {
    const users = new Map();

    for (const event of Array.isArray(events) ? events : []) {
        const name = event.eventName || event.name;
        const data = event.eventData || event.args || {};

        if (name === 'ArtworkRegistered') {
            const user = ensureUser(users, data.creator);
            if (user) user.artworkUploads += 1;
        } else if (name === 'BidPlaced') {
            const user = ensureUser(users, data.bidder);
            if (user) user.auctionParticipations += 1;
        } else if (name === 'SettlementCompleted') {
            const user = ensureUser(users, data.winner);
            if (user) user.successfulSettlements += 1;
        } else if (name === 'SettlementDefaulted') {
            const user = ensureUser(users, data.winner);
            if (user) user.failedSettlements += 1;
        } else if (name === 'ProjectNFTMinted') {
            const user = ensureUser(users, data.user);
            if (user) user.genesisOwned = true;
        }
    }

    for (const [address, extra] of Object.entries(externalSignals || {})) {
        const user = ensureUser(users, address);
        if (!user) continue;
        user.artworkInteractions += toNumber(extra.artworkInteractions);
        user.suspiciousFlags += toNumber(extra.suspiciousFlags);
        user.genesisOwned = user.genesisOwned || Boolean(extra.genesisOwned);
    }

    return Array.from(users.values()).map(signal => ({
        ...signal,
        ...computeTrustWeight(signal)
    }));
}

export function buildDiscoveryProjection({ artworks = [], events = [], externalSignals = {} } = {}) {
    const trustProjection = buildTrustProjection(events, externalSignals);
    const trustByAddress = new Map(trustProjection.map(item => [item.address, item]));

    const projectedArtworks = (Array.isArray(artworks) ? artworks : []).map(artwork => {
        const creator = normalizeAddress(artwork.creator || artwork.creator_id);
        const trust = trustByAddress.get(creator) || computeTrustWeight({});
        const socialSignals = externalSignals.artworks?.[artwork.id] || {};
        const voteCount = toNumber(artwork.vote_count || socialSignals.likes);
        const wouldBuy = toNumber(socialSignals.wouldBuy || artwork.would_buy_count);
        const watching = toNumber(socialSignals.watching || artwork.watch_count);
        const bidCount = toNumber(artwork.bid_count || socialSignals.bids);

        return {
            ...artwork,
            creator_trust_score: trust.score,
            creator_trust_weight: trust.influenceWeight,
            discovery_score: Math.round(
                (voteCount * 2 + wouldBuy * 5 + watching * 3 + bidCount * 4) *
                trust.influenceWeight
            )
        };
    });

    return {
        artworks: projectedArtworks.sort((a, b) => b.discovery_score - a.discovery_score),
        trust: trustProjection
    };
}
