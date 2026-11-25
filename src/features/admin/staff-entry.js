// A tab-local navigation hint. Only the staff API can authorize the workspace.
export function staffEntryHint(wallet, browser, eligible) {
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) return false;
    const key = 'artsoul:staff-entry:' + wallet;
    try {
        const store = browser.sessionStorage;
        if (eligible === true) store.setItem(key, '1');
        else if (eligible === false) store.removeItem(key);
        return store.getItem(key) === '1';
    } catch {
        return false;
    }
}

export function repeatsStaffWalletUpdate(event, wallet, browser) {
    return event?.detail?.isConnected === true && browser.artsoulWalletStateSettled === true &&
        String(event.detail.address || '').toLowerCase() === wallet &&
        String(browser.getCurrentWalletAddress?.() || browser.currentWalletAddress || '').toLowerCase() === wallet &&
        String(browser.SupabaseAuth?.getAuthenticatedWallet?.() || '').toLowerCase() === wallet;
}
