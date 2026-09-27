/**
 * Presentation only. The caller must supply one already-authorized aura kind.
 * This helper never derives eligibility from artwork metadata or profile claims.
 * Use the same class string on a preview or contained detail-media wrapper.
 * Verified assignment and priority are intentionally deferred to C-14.
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
