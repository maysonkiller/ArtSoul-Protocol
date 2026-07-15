const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const appKit = read('appkit-init.js');
const coreWallet = read('wallet-core-connect.js');
const avatar = read('avatar-dropdown.js');

function loadCoreRestoreHarness() {
    const executableSource = coreWallet
        .replace(/import \{ WalletConnectModal \} from [^;]+;/, 'const WalletConnectModal = class {};')
        .replace(/\bexport\s+/g, '');
    return new Function(
        'window',
        `${executableSource}\nreturn { waitForCoreSessionSnapshot, readCoreSessionSnapshot, resolveCoreSessionChainId, resolveCoreRequestChainId, requestCoreWalletMethod, getCoreWalletApprovalUrl };`
    )({ addEventListener() {}, location: { origin: 'https://artsoul.vercel.app' } });
}

test('core session restore distinguishes "no session" from a restore error', () => {
    assert.match(coreWallet, /export async function restoreCoreSessionOutcome/);
    assert.match(coreWallet, /export async function waitForCoreSessionSnapshot/);
    assert.match(coreWallet, /CORE_RESTORE_TIMEOUT_MS = 4500/);
    assert.match(coreWallet, /\{ status: 'none', session: null \}/);
    assert.match(coreWallet, /\{ status: 'restored', session: restored \}/);
    assert.match(coreWallet, /\{ status: 'error', session: null, error \}/);
    // The legacy API stays for the isolation page.
    assert.match(coreWallet, /export async function restoreCoreSession\(/);
    assert.match(appKit, /restoreCoreSessionOutcome/);
});

test('external mobile runs one WalletConnect client and exposes only a compatibility facade', () => {
    const runtimeSelection = appKit.match(
        /const externalMobileCorePath = isMobile && !isInjectedWalletBrowser\(\);[\s\S]*?if \(externalMobileCorePath\) \{[\s\S]*?\n\s*\} else \{[\s\S]*?modal = createAppKit\(config\);/
    )?.[0] || '';
    assert.ok(runtimeSelection, 'mobile and AppKit runtimes must be selected explicitly');
    const coreBranch = runtimeSelection.split('} else {')[0];
    assert.match(coreBranch, /modal = createExternalMobileCoreFacade\(\)/);
    assert.match(coreBranch, /appKitRuntimeActive: false/);
    assert.match(coreBranch, /wagmiRuntimeActive: false/);
    assert.doesNotMatch(coreBranch, /new WagmiAdapter|createAppKit/);
    assert.match(runtimeSelection, /wagmiAdapter = new WagmiAdapter/);
    assert.match(runtimeSelection, /modal = createAppKit\(config\)/);

    const facade = appKit.match(/function createExternalMobileCoreFacade\(\) \{[\s\S]*?\n\}/)?.[0] || '';
    assert.match(facade, /getConnectedCoreProvider\(\) \|\| getCoreProviderInstance\(\)/);
    assert.match(facade, /getAccount: readAccount/);
    assert.match(facade, /open: async \(\) => window\.safeConnectWallet/);
    assert.match(facade, /disconnect: async \(\) => false/);
});

test('restore race: no page-load timer decides "disconnected" before the core restore settles', () => {
    // Boot starts one bounded core-provider restore lifecycle. AppKit is not
    // allowed to publish guest while that lifecycle is restoring.
    assert.match(appKit, /coreSessionRestoreTask = restoreCoreSessionOutcome\(\)/);
    assert.match(appKit, /setMobileCoreRestoreState\('restoring'/);
    assert.match(appKit, /disconnected state ignored during core restore/);
    // The 4s fail-open defers to the in-flight restore on the mobile core path.
    const failOpen = appKit.match(/setTimeout\(\(\) => \{\s*\n\s*if \(window\.artsoulWalletStateSettled === true\) return;[\s\S]*?WALLET_SETTLE_FAILOPEN_TIMEOUT\)/)?.[0] || '';
    assert.match(failOpen, /coreSessionRestoreTask && !coreSessionRestoreSettled/);
    assert.match(failOpen, /fail-open deferred to core session restore/);
    // The 8s hydration timeout waits for the restore instead of wiping the hint.
    const hydrationTimer = appKit.match(/walletHydrationTimer = setTimeout\(\(\) => \{[\s\S]*?WALLET_HYDRATION_TIMEOUT\)/)?.[0] || '';
    assert.match(hydrationTimer, /coreSessionRestoreCompletion && !coreSessionRestoreSettled/);
    // Protected actions await the restore promise, not the momentary state.
    const ensureConnected = appKit.match(/window\.ensureWalletConnected = async[\s\S]*?\n\};/)?.[0] || '';
    assert.match(ensureConnected, /await coreSessionRestoreCompletion/);
    assert.match(ensureConnected, /await waitForWalletHydration\(\)/);
});

test('delayed WalletConnect persistence hydration restores before the bounded deadline', async () => {
    const { waitForCoreSessionSnapshot } = loadCoreRestoreHarness();
    let clock = 0;
    let polls = 0;
    const provider = { session: null, accounts: [], chainId: 84532 };
    const snapshot = await waitForCoreSessionSnapshot(provider, {
        timeoutMs: 4500,
        pollIntervalMs: 100,
        now: () => clock,
        wait: async (ms) => {
            clock += ms;
            polls += 1;
            if (polls === 3) {
                provider.session = {
                    namespaces: {
                        eip155: { accounts: ['eip155:84532:0x6ec800000000000000000000000000000000989b'] }
                    }
                };
            }
        }
    });

    assert.equal(snapshot.address, '0x6ec800000000000000000000000000000000989b');
    assert.equal(snapshot.chainId, 84532);
    assert.equal(clock, 300);
});

test('restored core session accepts only an explicit switch proof outside its namespaces', () => {
    const { resolveCoreSessionChainId } = loadCoreRestoreHarness();
    const provider = {
        chainId: 84532,
        session: {
            namespaces: {
                eip155: {
                    chains: ['eip155:1', 'eip155:8453'],
                    accounts: ['eip155:8453:0x6ec800000000000000000000000000000000989b']
                }
            }
        }
    };

    assert.equal(resolveCoreSessionChainId(provider, 8453), 8453);
    assert.equal(resolveCoreSessionChainId(provider, null), null);
    assert.equal(resolveCoreSessionChainId(provider, 84532), 84532);
    provider.chainId = 8453;
    assert.equal(resolveCoreSessionChainId(provider, null), 8453);
    assert.equal(resolveCoreSessionChainId(provider, 84532), 84532);

    // Production display and write validation may reuse only the topic-bound
    // switch proof. Without it, they never fall through to an SDK-configured
    // chain that the wallet did not approve.
    assert.match(appKit, /if \(provider === coreProvider && provider\?\.session\) \{\s*\n\s*const confirmedCoreChainId = getLastConfirmedCoreChainId\(\);\s*\n\s*return confirmedCoreChainId \|\| resolveCoreSessionChainId\(provider\);/);
    assert.match(appKit, /if \(appKitProvider === coreProvider && coreProvider\?\.session\) \{\s*\n\s*const confirmedCoreChainId = getLastConfirmedCoreChainId\(\);\s*\n\s*return confirmedCoreChainId \|\| resolveCoreSessionChainId\(coreProvider\);/);
    assert.match(avatar, /if \(provider\) chainId = this\.parseChainId\(providerChainId\);/);
});

test('bounded restore performs a final read and settles disconnected when no session exists', async () => {
    const { waitForCoreSessionSnapshot } = loadCoreRestoreHarness();
    let clock = 0;
    const provider = { session: null, accounts: [], chainId: null };
    const snapshot = await waitForCoreSessionSnapshot(provider, {
        timeoutMs: 400,
        pollIntervalMs: 100,
        now: () => clock,
        wait: async (ms) => { clock += ms; }
    });

    assert.equal(snapshot, null);
    assert.equal(clock, 400);
});

test('only a clean "no session" clears the stored wallet; a restore error keeps the hint', () => {
    const completion = appKit.match(/coreSessionRestoreCompletion = coreSessionRestoreTask\.then[\s\S]*?coreSessionRestoreSettled = true;\s*\n\s*\}\);/)?.[0] || '';
    assert.ok(completion, 'restore completion handler must exist');
    assert.match(completion, /outcome\.status === 'none'/);
    assert.match(completion, /localStorage\.removeItem\('artsoul_wallet'\)/);
    // The guest dispatch must not run through updateNavButtons(null), which
    // would erase the stored wallet hint even for a transient restore error.
    assert.doesNotMatch(completion, /updateNavButtons\(null\)/);
    // A restored session still binds the disconnect classifier.
    assert.match(completion, /bindCoreProviderDisconnect\(restored\.provider\)/);
    assert.match(completion, /applyConfirmedWalletState/);
    assert.match(completion, /scheduleMobileOperationalNetworkPrompt\(restored\.provider, 'boot session restore'\)/);
});

test('disconnect classification: transient and backgrounded drops never wipe; genuine ends do', () => {
    const handler = appKit.match(/async function handleCoreProviderDisconnect[\s\S]*?\n\}/)?.[0] || '';
    assert.match(handler, /coreSessionStillLive\(provider\)/);
    assert.match(handler, /restartWalletConnectTransport\('core transient disconnect'\)/);
    // Backgrounded disconnects are deferred, never wiped blind.
    assert.match(handler, /document\.visibilityState === 'hidden'/);
    assert.match(handler, /pendingCoreDisconnectProvider = provider/);
    // The deferred drop is re-checked after the relay restarts on return.
    assert.match(appKit, /async function recheckDeferredCoreDisconnect/);
    const recheck = appKit.match(/async function recheckDeferredCoreDisconnect[\s\S]*?\n\}/)?.[0] || '';
    assert.match(recheck, /restartWalletConnectTransport/);
    assert.match(recheck, /coreSessionStillLive\(provider\)/);
    assert.match(recheck, /'core walletconnect disconnect'/);
    assert.match(recheck, /genuineDisconnect: true/);
    // Genuine session_delete still wipes.
    assert.match(appKit, /provider\.on\?\.\('session_delete'/);
});

test('returning from background restarts the relay for a restored core session', () => {
    const resume = appKit.match(/async function processWalletResume[\s\S]*?\n\}/)?.[0] || '';
    assert.match(resume, /isCoreSessionActive\(\)/);
    // An in-flight connect() also restarts the relay on return, so the
    // wallet's approval lands in this tab and the pending connect settles.
    assert.match(resume, /isCoreConnectInFlight\(\)/);
    assert.match(resume, /await restartWalletConnectTransport\(source\)/);
    assert.match(resume, /recheckDeferredCoreDisconnect\(source\)/);
});

test('mobile header keeps the stable shell until a complete cached identity exists', () => {
    const initializing = avatar.match(/renderInitializingState\(\) \{[\s\S]*?\n        \}/)?.[0] || '';
    assert.match(initializing, /artsoul_wallet/);
    assert.match(initializing, /isMobileUA/);
    assert.match(initializing, /wallet-state-resolving/);
    assert.doesNotMatch(initializing, /cachedIdentity = \{[\s\S]*?getDefaultAvatar/);
});

test('a live core session outranks AppKit/injected empty-account events', () => {
    // The prod navigation bug: on every MPA page load AppKit knows nothing
    // about the core WalletConnect session, so its empty/disconnected account
    // events wiped the restored wallet. On the standard path AppKit account
    // events are fully inert for mobile external browsers.
    assert.match(appKit, /appkit account event ignored \(standard mobile external path\)/);
    // accountsChanged []: while the core session record is alive, NO empty
    // event may wipe it — including the core provider's own chain-filtered
    // empty accounts (SDK setAccounts drops accounts of foreign chains).
    assert.match(appKit, /empty accountsChanged ignored; core session is authoritative/);
    const accountsGuard = appKit.match(/if \(!nextAddress\) \{[\s\S]*?getConnectedCoreProvider\(\);\s*\n\s*if \(coreProvider && !genuineCoreSessionEnd\) \{/)?.[0] || '';
    assert.ok(accountsGuard, 'handleProviderAccountsChanged must ignore empty accounts while the core session record is alive');
    assert.match(appKit, /empty accountsChanged reconciled to live core session/);
});

test('restore is chain-tolerant: a session parked on a foreign chain stays connected', () => {
    // The SDK filters instance.accounts by the CURRENT chainId and persists a
    // foreign chainId (observed: MetaMask parked on 8453) across page loads,
    // so the filtered accounts getter can report [] for a live session. The
    // address must be read chain-independently from the session namespaces.
    assert.match(coreWallet, /export function getCoreSessionAddress/);
    const helper = coreWallet.match(/export function getCoreSessionAddress[\s\S]*?\n\}/)?.[0] || '';
    assert.match(helper, /namespaces/);
    assert.match(helper, /eip155:\\d\+/);
    // restoreCoreSessionOutcome resolves through the bounded snapshot helper,
    // which reads the address chain-independently from session namespaces.
    const restoreOutcome = coreWallet.match(/export async function restoreCoreSessionOutcome[\s\S]*?\n\}/)?.[0] || '';
    assert.match(restoreOutcome, /waitForCoreSessionSnapshot\(instance/);
    const readSnapshot = coreWallet.match(/export function readCoreSessionSnapshot[\s\S]*?\n\}/)?.[0] || '';
    assert.match(readSnapshot, /getCoreSessionAddress\(instance\)/);
    assert.doesNotMatch(restoreOutcome, /instance\.accounts \|\| \[\]/);
    // The boot handler applies the restored address without a chain gate, then
    // schedules the independent operational-network confirmation.
    const completion = appKit.match(/coreSessionRestoreCompletion = coreSessionRestoreTask\.then[\s\S]*?coreSessionRestoreSettled = true;\s*\n\s*\}\);/)?.[0] || '';
    assert.match(completion, /restoredChainId = resolveCoreSessionChainId\(/);
    assert.match(completion, /applyConfirmedWalletState\(\{\s*\n\s*address: restored\.address,\s*\n\s*chainId: restoredChainId/);
    assert.doesNotMatch(completion, /BASE_SEPOLIA_CHAIN_ID/);
    // Restore does not inline an add/switch cycle or block address hydration.
    assert.doesNotMatch(completion, /ensureExternalMobileBaseSepolia/);
    // The hydration-timeout fallback also reads the address chain-independently.
    const staleClear = appKit.match(/const clearStaleWalletState = async \(\) => \{[\s\S]*?\n        \};/)?.[0] || '';
    assert.match(staleClear, /getCoreSessionAddress\(coreProvider\)/);
});

test('chainChanged to any network updates the display and never erases the session', () => {
    // Repeated chainChanged -> 8453 after a relay restart must only update
    // the stored/displayed chain; connected state is preserved.
    const chainConfirmed = appKit.match(/async function handleProviderChainConfirmed[\s\S]*?\n\}/)?.[0] || '';
    assert.ok(chainConfirmed, 'handleProviderChainConfirmed must exist');
    assert.match(chainConfirmed, /setCurrentChainId\(chainId\)/);
    assert.match(chainConfirmed, /isConnected: true/);
    assert.doesNotMatch(chainConfirmed, /isConnected: false/);
    assert.doesNotMatch(chainConfirmed, /removeItem\('artsoul_wallet'\)/);
    assert.doesNotMatch(chainConfirmed, /updateNavButtons\(null\)/);
});

test('core wallet methods bypass a fictitious SDK chain and use an approved session route', async () => {
    const { resolveCoreRequestChainId, requestCoreWalletMethod } = loadCoreRestoreHarness();
    const requests = [];
    const provider = {
        chainId: 84532,
        session: {
            namespaces: {
                eip155: {
                    chains: ['eip155:1', 'eip155:8453'],
                    accounts: ['eip155:8453:0x6ec800000000000000000000000000000000989b']
                }
            }
        },
        signer: {
            request: async (request, route) => {
                requests.push({ request, route });
                return null;
            }
        }
    };

    assert.equal(resolveCoreRequestChainId(provider), 8453);
    await requestCoreWalletMethod(provider, {
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x14a34' }]
    });
    assert.deepEqual(requests, [{
        request: {
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x14a34' }]
        },
        route: 'eip155:8453'
    }]);
});

test('a settled mobile session exposes its wallet approval link without changing connect metadata', () => {
    const { getCoreWalletApprovalUrl } = loadCoreRestoreHarness();
    const provider = {
        session: {
            peer: {
                metadata: {
                    redirect: {
                        native: 'metamask://',
                        universal: 'https://metamask.app.link'
                    }
                }
            }
        }
    };
    assert.equal(getCoreWalletApprovalUrl(provider), 'metamask://');
});

test('core chain inference cannot bypass explicit Base Sepolia confirmation', () => {
    assert.match(appKit, /CORE_NETWORK_CONFIRMATION_KEY = 'artsoul_core_network_confirmation_v2'/);
    assert.match(appKit, /stored\?\.topic !== topic/);
    assert.match(appKit, /coreSessionNeedsBaseSepoliaConfirmation/);
    const lastConfirmed = appKit.match(/function getLastConfirmedCoreChainId[\s\S]*?\n\}/)?.[0] || '';
    assert.match(lastConfirmed, /readCoreNetworkConfirmation\(getConnectedCoreProvider\(\)\)/);
    const guard = appKit.match(/window\.ensureArtSoulWriteNetwork = async[\s\S]*?\n\};/)?.[0] || '';
    assert.match(guard, /currentChainId !== BASE_SEPOLIA_CHAIN_ID \|\| requiresCoreConfirmation/);
    assert.match(guard, /confirmCoreBaseSepolia\(provider, 'write guard'\)/);
    const selector = appKit.match(/window\.switchArtSoulNetwork = async[\s\S]*?\n\};/)?.[0] || '';
    assert.match(selector, /currentChainId === target\.chainId && !requiresCoreConfirmation/);
    assert.match(selector, /confirmCoreBaseSepolia\(provider, 'account menu'\)/);
    const confirmNetwork = appKit.match(/async function confirmCoreBaseSepolia[\s\S]*?\n\}/)?.[0] || '';
    assert.match(confirmNetwork, /switchThenAddCoreEthereumChain\(provider, target\)/);
    assert.match(confirmNetwork, /waitForCoreBaseSepoliaConfirmation\(provider\)/);
    assert.doesNotMatch(confirmNetwork, /method: 'eth_chainId'/);
    assert.match(appKit, /CORE_NETWORK_CONFIRMATION_TIMEOUT = 30000/);
    assert.match(appKit, /requestCoreNetworkMethod\(provider, \{\s*\n\s*method: 'wallet_addEthereumChain'/);
    assert.match(appKit, /requestCoreNetworkMethod\(provider, \{\s*\n\s*method: 'wallet_switchEthereumChain'/);
    assert.match(appKit, /getCoreWalletApprovalUrl\(provider\)/);
    const switchFlow = appKit.match(/async function switchThenAddCoreEthereumChain[\s\S]*?\n\}/)?.[0] || '';
    assert.ok(switchFlow.indexOf("method: 'wallet_switchEthereumChain'") < switchFlow.indexOf("method: 'wallet_addEthereumChain'"));
    assert.match(switchFlow, /isUnknownChainError\(error\)/);
    assert.match(switchFlow, /writeCoreNetworkConfirmation\(provider, target\.chainId\)/);
    const scheduledPrompt = appKit.match(/function scheduleMobileOperationalNetworkPrompt[\s\S]*?\n\}/)?.[0] || '';
    assert.match(scheduledPrompt, /const accepted = await window\.confirm\(/);
});

test('network confirmation and SIWE are serialized for the mobile core provider', () => {
    const authentication = appKit.match(/window\.ensureAuthenticated = async[\s\S]*?\n\};/)?.[0] || '';
    assert.match(authentication, /if \(authenticationPromise\) return authenticationPromise/);
    assert.match(authentication, /coreSessionNeedsBaseSepoliaConfirmation\(coreProvider\)/);
    assert.ok(
        authentication.indexOf('ensureArtSoulWriteNetwork') < authentication.indexOf("SIWE signature requested"),
        'Base Sepolia confirmation must finish before SIWE starts'
    );
    const authSource = fs.readFileSync(path.join(__dirname, '..', 'supabase-auth.js'), 'utf8');
    assert.match(authSource, /requestWalletProvider\(activeProvider, \{ method: 'eth_accounts' \}\)/);
    assert.match(authSource, /requestWalletProvider\(activeProvider, \{\s*\n\s*method: 'personal_sign'/);
});

test('external mobile header trusts the settled wallet state over AppKit/injected reads', () => {
    // Unconfirmed sync() calls (nav rebuild, late module load) must not flip
    // a live core-path wallet to Connect Wallet just because AppKit and
    // window.ethereum cannot see the core session.
    const confirmed = avatar.match(/isWalletConnectionConfirmed\(walletAddress, options = \{\}\) \{[\s\S]*?\n        \}/)?.[0] || '';
    assert.match(confirmed, /artsoulSettledWalletState/);
    assert.match(confirmed, /isMobileUA && !window\.ethereum\?\.request/);
});

test('protected actions prefer the restored mobile core provider', () => {
    const providerSelection = appKit.match(/async function getProviderForWallet[\s\S]*?\n\}/)?.[0] || '';
    assert.match(providerSelection, /getConnectedCoreProvider\(\)/);
    assert.match(providerSelection, /getCoreSessionAddress\(coreProvider\)/);
    assert.match(providerSelection, /source: 'mobile core'/);
    assert.match(appKit, /modal\.getWalletProvider = async/);
    assert.match(appKit, /if \(coreProvider\) return coreProvider/);
});

test('the raw SDK connected toast is not emitted', () => {
    assert.doesNotMatch(appKit, /showToast\?\.\('Connected\.'/);
});

test('hydration-timeout wipe re-confirms from the live core session record', () => {
    const staleClear = appKit.match(/const clearStaleWalletState = async \(\) => \{[\s\S]*?\n        \};/)?.[0] || '';
    assert.ok(staleClear, 'clearStaleWalletState must exist');
    assert.match(staleClear, /getConnectedCoreProvider\(\)/);
    assert.match(staleClear, /applyConfirmedWalletState/);
});

test('X/Discord linking routes through ensureWalletConnected instead of an error toast', () => {
    const profile = read('src/entries/profile.jsx');
    const socialConnect = profile.match(/async function handleSocialConnect[\s\S]*?\n            \}/)?.[0] || '';
    assert.match(socialConnect, /await window\.ensureWalletConnected\?\.\(\)/);
    const socialDisconnect = profile.match(/async function handleSocialDisconnect[\s\S]*?\n            \}/)?.[0] || '';
    assert.match(socialDisconnect, /await window\.ensureWalletConnected\?\.\(\)/);
});

test('explicit disconnect does not resurrect: cache clear runs before restore starts', () => {
    const initSection = appKit.match(/const explicitDisconnectRequested = sessionStorage\.getItem\('artsoul_disconnecting'\);[\s\S]*?coreSessionRestoreTask = restoreCoreSessionOutcome\(\);/)?.[0] || '';
    assert.ok(initSection, 'explicit-disconnect cleanup must precede the restore kick-off');
    assert.match(initSection, /await clearWalletConnectionCache\(\)/);
    // Restore only runs on the mobile external-browser path.
    assert.match(initSection, /isMobile && !isInjectedWalletBrowser\(\)/);
    // Disconnect settles the UI in place — never via reload/redirect.
    const reset = appKit.match(/window\.resetWalletConnection = async[\s\S]*?\n\};/)?.[0] || '';
    assert.match(reset, /disconnectCoreWallet\(\)/);
    assert.doesNotMatch(reset, /location\./);
});
