/**
 * Presentation only. The caller must supply one already-authorized aura kind.
 * This helper never derives eligibility from artwork metadata or profile claims.
 * Use the same class string on a preview or contained detail-media wrapper.
 */
export function auraFrameClassName(kind = 'none') {
    switch (kind) {
        case 'platform':
        case 'genesis':
        case 'partner':
            return `artsoul-aura-frame artsoul-aura-frame--${kind}`;
        default:
            return '';
    }
}

export const auraFrameLabels = Object.freeze({
    platform: 'ArtSoul platform NFT',
    genesis: 'Genesis aura',
    partner: 'Partner collection NFT'
});

export const auraWords = Object.freeze({platform: 'ArtSoul', genesis: 'Genesis', partner: 'Partner'});

// The caption stays decorative. Its parent exposes the full provenance label.
export function auraCaption(h, word) {
    if (!Object.values(auraWords).includes(word)) return null;
    return h('span', {className: 'artsoul-aura-caption', 'aria-hidden': 'true'},
        h('span', {className: 'aura-still'}, word),
        ...Array.from(word, (letter, index) => h('i', {key: index,
            style: {'--glyph-offset': (index * 0.73) + 'em'}}, letter)));
}

export function projectedArtworkAura(artwork) {
    if (artwork?.source !== 'v41_projection' || artwork.minted !== true ||
        (artwork.ownership_status !== 'verified' &&
            !(artwork.aura_kind === 'platform' && artwork.chain_id === 84532 && artwork.platform_origin_verified === true))) return null;
    const kind = artwork.aura_kind;
    const chain = artwork.chain_id;
    if (![8453, 84532, '8453', '84532'].includes(chain) ||
        (kind === 'genesis' && Number(chain) !== 8453)) return null;
    const className = auraFrameClassName(kind);
    return className ? { className, label: auraFrameLabels[kind],
        ...(artwork.aura_border_text === true ? { borderLabel: auraWords[kind] } : {}) } : null;
}
