import { homeSlots, promotionSlots, readBannerSchedule } from './banner-schedule.js';

function ethAmount(wei) {
    const digits = wei.padStart(19, '0');
    const fraction = digits.slice(-18).replace(/0+$/, '');
    return digits.slice(0, -18) + (fraction ? '.' + fraction : '') + ' ETH';
}

// The visual lab passes a fixed schedule and an already-ranked, visible catalog.
// An auction award can preview its terms here without certifying a payment.
export function previewHomepageBanners(ranked, schedule, creatives, asOf) {
    const catalog = new Map();
    for (const artwork of Array.isArray(ranked) ? ranked : []) {
        if (artwork?.id && !catalog.has(artwork.id)) catalog.set(artwork.id, artwork);
    }
    const organic = [...catalog.values()];
    const fallback = organic.slice(0, homeSlots).map(artwork => ({ artwork }));
    const protectedCount = homeSlots - promotionSlots;
    if (organic.length < protectedCount || !schedule || !(creatives instanceof Map)) return fallback;

    let book;
    try { book = readBannerSchedule(schedule, asOf); } catch { return fallback; }
    const slots = fallback.slice(0, protectedCount);
    const used = new Set(slots.map(slot => slot.artwork.id));
    const promoted = new Map();
    for (const placement of [...book.placements.values()].sort((a, b) => a.slot - b.slot)) {
        if (placement.startsAt > asOf || asOf >= placement.endsAt) continue;
        const award = book.awards.get(placement.id);
        const group = award?.sponsorGroup || placement.sponsorGroup;
        const creative = creatives.get(placement.id);
        if (!group || !creative || creative.sponsorGroup !== group) continue;
        const disclosure = award ?? placement;
        const sponsor = disclosure.sponsorName;
        const relationship = disclosure.relationship;
        if (typeof sponsor !== 'string' || !sponsor.trim() || typeof relationship !== 'string' || !relationship.trim()) continue;
        const artwork = catalog.get(creative.artworkId);
        if (!artwork || used.has(artwork.id)) continue;
        let consideration = 'Free partner placement';
        if (award) consideration = 'Winning banner bid of ' + ethAmount(award.winningBidWei);
        if (placement.kind === 'negotiated') {
            consideration = 'Negotiated fee of ' + ethAmount(placement.feeWei);
            if (placement.inKind) consideration += ' plus ' + placement.inKind.trim();
        }
        used.add(artwork.id);
        promoted.set(placement.slot, {
            artwork,
            promotion: { sponsor: sponsor.trim(), relationship: relationship.trim(), consideration }
        });
    }
    const remaining = organic.filter(artwork => !used.has(artwork.id));
    for (let lane = 1; lane <= promotionSlots; lane++) {
        if (promoted.has(lane)) slots.push(promoted.get(lane));
        else if (remaining.length) slots.push({ artwork: remaining.shift() });
    }
    return slots;
}
