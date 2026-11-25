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

const labels = {
    platform: 'ArtSoul platform NFT',
    genesis: 'Genesis aura',
    partner: 'Partner collection NFT'
};

export function projectedArtworkAura(artwork) {
    if (artwork?.source !== 'v41_projection' || artwork.minted !== true ||
        artwork.ownership_status !== 'verified') return null;
    const kind = artwork.aura_kind;
    const chain = artwork.chain_id;
    if (![8453, 84532, '8453', '84532'].includes(chain) ||
        (kind === 'genesis' && Number(chain) !== 8453)) return null;
    const className = auraFrameClassName(kind);
    return className ? { className, label: labels[kind],
        ...(artwork.aura_border_text === true ? { borderLabel: labels[kind] } : {}) } : null;
}
