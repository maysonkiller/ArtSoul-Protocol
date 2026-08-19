function normalizeAddress(value) {
    return String(value || '').trim().toLowerCase();
}

/**
 * Whether the wallet layer has produced a definitive answer yet.
 *
 * An address in the page URL says which profile to render. It says nothing
 * about whether the wallet has settled, and conflating the two is what hid the
 * owner's own actions when a profile was opened from an artwork link.
 */
export function isWalletStateSettled({ settledFlag = false, walletEvent = null } = {}) {
    if (settledFlag === true) return true;
    return typeof walletEvent?.isConnected === 'boolean';
}

/**
 * Resolve whether the viewed profile belongs to the connected wallet.
 *
 * Returns `null` while the wallet has not settled. `null` means "not decided
 * yet" and must never be rendered as ownership: callers fail closed and show no
 * owner-only action until a definitive `true` arrives.
 */
export function resolveProfileOwnership({
    walletSettled = false,
    viewedAddress = '',
    confirmedAddress = ''
} = {}) {
    if (!walletSettled) return null;

    const viewed = normalizeAddress(viewedAddress);
    const confirmed = normalizeAddress(confirmedAddress);
    if (!viewed || !confirmed) return false;

    return viewed === confirmed;
}
