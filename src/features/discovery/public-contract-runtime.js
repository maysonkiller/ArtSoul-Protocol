// This fixed URL is also used by the unbundled artwork and profile pages.
// Leave the import to the browser so the homepage build cannot preload ethers.
const contractModule = '/contracts-integration.js?v=22';

export function installPublicContractRuntime(loadPageServices) {
    let loading;
    function load() {
        if (!loading) {
            loading = import(/* @vite-ignore */ contractModule)
                .then(loadPageServices)
                .then(() => window.ArtSoulContracts)
                .catch(error => {
                    loading = undefined;
                    throw error;
                });
        }
        return loading;
    }

    // Keep the existing browser-tool hook so cached assistants can make their
    // first request on either public page.
    window.loadArtSoulGalleryContracts = load;
    function restore(state) {
        if (state?.isConnected && /^0x[0-9a-f]{40}$/i.test(state.address)) {
            // Signer initialization and account/network validation belong to the action.
            load().catch(() => {});
        }
    }
    window.addEventListener('artsoul:wallet-state-changed', event => restore(event.detail));
    restore(window.artsoulSettledWalletState);
}
