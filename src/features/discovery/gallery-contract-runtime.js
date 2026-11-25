// Browsing the indexed gallery needs the small UI components, including in a
// guest tab. The contract and auction services are needed by connected wallets.
import '../../ui/components/index.js';

let loading;
function loadGalleryContracts() {
    if (!loading) {
        loading = import('/contracts-integration.js?v=22')
            .then(() => import('../../index.js'))
            .then(() => window.ArtSoulContracts)
            .catch(error => {
                loading = undefined;
                throw error;
            });
    }
    return loading;
}

window.loadArtSoulGalleryContracts = loadGalleryContracts;
function restore(state) {
    if (state?.isConnected && /^0x[0-9a-f]{40}$/i.test(state.address)) {
        // Importing the adapter does not initialize a signer. The requesting
        // action verifies the current account and network after loading.
        loadGalleryContracts().catch(() => {});
    }
}
window.addEventListener('artsoul:wallet-state-changed', event => restore(event.detail));
restore(window.artsoulSettledWalletState);
