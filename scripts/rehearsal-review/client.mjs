import { rehearsalCore } from './deployment.mjs';

// The local test fixture is shared with the read-only planner. It accepts no caller-supplied metadata.
export const rehearsalArtwork = Object.freeze({
    core: rehearsalCore,
    nft: '0x810DD5459c9cC5d82f13F8D52545a654Ec0bbe4c',
    coreHash: '0x4d18f0243cff1ef906a07a3517949045c6fe3a9e8b584e60bcbe7ad021bef54e',
    nftHash: '0xcbff8b3bb46c10d150d5812846d5d8c990c0156215d5978b44e238a86d141bac',
    title: 'ArtSoul Base Sepolia Rehearsal',
    dataSha256: '134d57c45b210427d7193990e3fd2a587692421b92904d7d83eb4331ea56bc3b'
});

export const rehearsalMetadataUri = 'data:application/json;base64,' + btoa(JSON.stringify({
    name: rehearsalArtwork.title,
    description: 'Technical test of artwork registration on Base Sepolia.',
    image: 'https://artsoulprotocol.com/favicon.jpg',
    media_type: 'image/jpeg'
}));

export const rehearsalOpening = Object.freeze({
    reserveWei: '1000000000000000', hours: '24',
    dataSha256: '11aa24f9a1a3fbfdd11b3f749cd96d166f0998452dbe27564627193579c7c8d7'
});

export const rehearsalLateBid = Object.freeze({
    bidder: '0x5e3167636c5EB7Fe143a3C9f40EA2Bf1d6888383',
    deposit: '0x2386f26fc10000', deadline: 1795728524, window: 600,
    dataSha256: '10c6ad880f409d520be64832b4ef0463869a2acc64dc461b36a25476304472ac'
});

export function lateBidWindow(blockTime, now = Math.floor(Date.now() / 1000)) {
    const { deadline, window } = rehearsalLateBid;
    check(Number.isSafeInteger(blockTime) && Math.abs(now - blockTime) <= 60, 'Recent chain time and local time disagree. Refresh before reviewing a bid.');
    if (Math.max(blockTime, now) >= deadline) return 'expired';
    if (Math.min(blockTime, now) < deadline - window) return 'early';
    return 'open';
}

const testChain = '0x14a34';
const factory = '0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67';
const roleName = { protocolTreasury: 'Protocol treasury', ecosystemTreasury: 'Ecosystem treasury', adminSecurity: 'Admin security' };
const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
function check(condition, message) { if (!condition) throw new Error(message); }

async function sha256(data) {
    check(typeof data === 'string' && /^0x(?:[\da-f]{2})+$/i.test(data), 'Invalid runtime or transaction data.');
    const bytes = Uint8Array.from(data.slice(2).match(/../g), byte => parseInt(byte, 16));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function readWallet(provider) {
    const [chain, accounts] = await Promise.all([
        provider.request({ method: 'eth_chainId' }), provider.request({ method: 'eth_accounts' })
    ]);
    return { chain: typeof chain === 'string' ? chain.toLowerCase() : '', account: accounts?.[0] };
}

function walletIssue({ chain, account }, plan) {
    const advice = [];
    if (!sameAddress(account, plan.payer)) advice.push(account
        ? 'Wallet selected ' + account + '. Select the displayed test payer ' + plan.payer + '.'
        : 'No account is connected. Connect the displayed test payer ' + plan.payer + '.');
    if (chain !== testChain || plan.chainId !== testChain) {
        const current = /^0x[\da-f]+$/.test(chain) ? BigInt(chain).toString() : 'unknown';
        advice.push('Current chain ID ' + current + '. Select Base Sepolia (84532).');
    }
    return advice.join(' ');
}

export async function matchWallet(provider, plan) {
    const issue = walletIssue(await readWallet(provider), plan);
    check(!issue, issue);
}

export async function walletRequest(provider, plan) {
    const rpc = (method, params) => provider.request({ method, params });
    await matchWallet(provider, plan);
    const create = ['OrdinaryMarket', 'OrdinaryPayoutMarket'].includes(plan.operation);
    const artwork = plan.operation === 'registerArtwork';
    const opening = plan.operation === 'createAuction';
    const bid = plan.operation === 'placeBid';
    if (artwork || opening || bid) {
        const approved = bid ? rehearsalLateBid : artwork ? rehearsalArtwork : rehearsalOpening;
        check(sameAddress(plan.target, rehearsalArtwork.core) && plan.dataSha256 === approved.dataSha256 &&
            plan.deployments.length === 0 &&
            plan.codeChecks.length === 2 && sameAddress(plan.codeChecks[0].address, rehearsalArtwork.core) &&
            sameAddress(plan.codeChecks[1].address, rehearsalArtwork.nft), 'Unexpected artwork request.');
        if (artwork) check(plan.metadataUri === rehearsalMetadataUri, 'Unexpected registration metadata.');
        if (bid) check(sameAddress(plan.payer, rehearsalLateBid.bidder) && plan.value === rehearsalLateBid.deposit,
            'Unexpected bidder or deposit.');
    } else {
        check(create || ['protocolTreasury', 'ecosystemTreasury'].includes(plan.operation), 'Unknown rehearsal operation.');
        check(create ? plan.target === 'Direct contract creation' :
            sameAddress(plan.target, factory) && plan.data.startsWith('0x1688f0b9'), 'Unexpected transaction target or method.');
    }
    check(await sha256(plan.data) === plan.dataSha256, 'Transaction data changed.');
    const [latest, pending, payerCode] = await Promise.all([
        rpc('eth_getTransactionCount', [plan.payer, 'latest']), rpc('eth_getTransactionCount', [plan.payer, 'pending']),
        rpc('eth_getCode', [plan.payer, 'latest']),
        ...plan.codeChecks.map(async ({ address, sha256: expected }) => {
            check(await sha256(await rpc('eth_getCode', [address, 'latest'])) === expected, 'Wallet RPC returned different contract code.');
        }),
        ...plan.deployments.map(async address => {
            const [code, nonce] = await Promise.all([
                rpc('eth_getCode', [address, 'latest']), rpc('eth_getTransactionCount', [address, 'pending'])
            ]);
            check(code === '0x' && BigInt(nonce) === 0n, 'Predicted address is already occupied or pending. Refresh after finality.');
        })
    ]);
    check(latest === plan.nonce && pending === plan.nonce && payerCode === '0x', 'Payer state changed. Refresh the chain evidence.');
    if (artwork || opening) {
        const simulation = await rpc('eth_call', [{ from: plan.payer, to: rehearsalArtwork.core, data: plan.data, value: '0x0' }, 'pending']);
        check(/^0x[0-9a-f]{64}$/i.test(simulation) && BigInt(simulation) === 1n,
            opening ? 'Auction history changed. Refresh the chain evidence.' : 'Work registry changed. Refresh the chain evidence.');
    }
    if (bid) {
        const call = { from: plan.payer, to: rehearsalArtwork.core, value: rehearsalLateBid.deposit, data: plan.data };
        const simulated = await rpc('eth_call', [call, 'pending']);
        const head = await rpc('eth_getBlockByNumber', ['latest', false]);
        check(simulated === '0x' && lateBidWindow(Number(BigInt(head.timestamp))) === 'open',
            'The reviewed first late bid is unavailable. Refresh the chain evidence.');
    }
    await matchWallet(provider, plan);
    const tx = { from: plan.payer, chainId: testChain, nonce: plan.nonce, value: bid ? rehearsalLateBid.deposit : '0x0', data: plan.data };
    if (!create) tx.to = plan.target;
    return tx;
}

export function sameReview(first, next) {
    return !next.complete && !next.waitingForFinality && !next.lateBidStatus && first.chainId === next.chainId && first.operation === next.operation &&
        first.payer === next.payer && first.nonce === next.nonce && first.target === next.target && first.value === next.value &&
        first.dataHash === next.dataHash && first.dataSha256 === next.dataSha256 &&
        JSON.stringify(first.codeChecks) === JSON.stringify(next.codeChecks) &&
        JSON.stringify(first.deployments) === JSON.stringify(next.deployments) &&
        JSON.stringify(first.owners) === JSON.stringify(next.owners) && JSON.stringify(first.roles) === JSON.stringify(next.roles);
}

export async function start() {
    const byId = id => document.getElementById(id);
    const status = message => { byId('status').textContent = message; };
    const walletStatus = message => { byId('wallet-status').textContent = message; };
    const picker = byId('wallet');
    const wallets = new Map();
    let plan, selected, connected, wrongChain = false, busy = false, submitted = false, stateRevision = 0;
    function buttons() {
        picker.disabled = busy || submitted;
        byId('connect').disabled = busy || submitted || !plan || !wallets.size;
        byId('connect').textContent = selected ? 'Recheck selected wallet' : 'Connect selected wallet';
        byId('switch').hidden = !wrongChain || !selected || submitted;
        byId('switch').disabled = busy || submitted;
        byId('discover').hidden = wallets.size > 0;
        byId('submit').disabled = busy || submitted || !connected;
        byId('refresh').disabled = busy;
    }
    function connectionHint() {
        return wallets.size ? 'Choose your extension and click Connect selected wallet to enable the review.'
            : 'No wallet detected. Open this address in the browser profile with your wallet extension enabled, then click Find browser wallets.';
    }
    async function recheck() {
        const revision = ++stateRevision;
        const provider = selected;
        connected = undefined; wrongChain = false; buttons();
        if (!provider || !plan || submitted) return;
        try {
            const state = await readWallet(provider);
            if (stateRevision !== revision) return;
            const issue = walletIssue(state, plan);
            wrongChain = state.chain !== testChain;
            if (!issue) connected = provider;
            walletStatus(issue || 'Connected to the reviewed payer on Base Sepolia. Select Review in wallet.');
        } catch (error) {
            if (stateRevision === revision) walletStatus(error.message);
        } finally { buttons(); }
    }
    function onWalletChanged() {
        if (submitted) return;
        void recheck();
    }
    function observe(provider) {
        if (selected === provider) return;
        stateRevision++;
        for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) {
            selected?.removeListener?.(event, onWalletChanged);
            provider?.on?.(event, onWalletChanged);
        }
        selected = provider; connected = undefined; wrongChain = false;
    }
    function register(id, name, provider) {
        if (typeof id !== 'string' || typeof name !== 'string' || !provider?.request ||
            wallets.has(id) || [...wallets.values()].includes(provider)) return;
        wallets.set(id, provider);
        picker.add(new Option(name, id));
        if (plan && !selected && !submitted) walletStatus(connectionHint());
        buttons();
    }
    window.addEventListener('eip6963:announceProvider', event => {
        const { info, provider } = event.detail ?? {};
        register(info?.uuid, info?.name, provider);
    });
    function discover() {
        window.dispatchEvent(new Event('eip6963:requestProvider'));
        if (!wallets.size) register('injected', 'Browser wallet', window.ethereum);
        if (plan && !selected && !submitted) walletStatus(connectionHint());
    }
    discover();
    window.addEventListener('ethereum#initialized', discover);
    byId('discover').onclick = discover;
    picker.onchange = () => { observe(undefined); walletStatus(connectionHint()); buttons(); };
    function addField(label, value) {
        const dt = document.createElement('dt'), dd = document.createElement('dd');
        dt.textContent = label; dd.textContent = value; byId('fields').append(dt, dd);
    }
    async function fetchPlan() {
        const response = await fetch('./plan.json', { cache: 'no-store', credentials: 'omit' });
        if (!response.ok) throw new Error(await response.text());
        return response.json();
    }
    function showOutcome(current) {
        if (!current.waitingForFinality && !current.complete && !current.lateBidStatus) return false;
        ++stateRevision; plan = undefined; connected = undefined; wrongChain = false;
        byId('review').hidden = true;
        if (current.lateBidStatus) {
            const messages = {
                early: 'Waiting for the late-bid window. Refresh between November 26, 21:18:44 and 21:28:44 UTC (22:18:44–22:28:44 Warsaw).',
                expired: 'The original late-bid window has ended.',
                changed: 'The first bid or auction state has changed. This rehearsal request is closed.'
            };
            status(messages[current.lateBidStatus]);
        } else if (current.existingAuctionHistory) {
            status('The reviewed Core already has finalized auction history. This first-auction request is closed. Use the opening receipt to verify the work and its terms.');
        } else if (current.finalizedArtwork) {
            status('Verified artwork ' + current.finalizedArtwork.id + ' · ' + rehearsalArtwork.title +
                ' · creator ' + current.payer + ' at finalized Base Sepolia block ' + BigInt(current.block.number) + '.');
        } else if (current.finalizedPair) {
            const { core, nft } = current.finalizedPair;
            status('Core ' + core + ' and NFT ' + nft + ' verified at finalized Base Sepolia block ' +
                BigInt(current.evidence.block.number) + ' (' + current.evidence.block.hash + '). Both providers verified the pair, treasury and admin bindings, and refund limits.');
        } else if (current.complete) {
            status(current.finalizedTreasury
                ? roleName[current.finalizedTreasury] + ' Safe verified at a finalized block.'
                : 'Both treasury Safes were verified at a finalized block.');
        } else {
            const waiting = current.waitingForFinality;
            const found = waiting.role === 'createAuction' ? 'Both providers see auction history on the reviewed Core' :
                waiting.role === 'registerArtwork' ? 'Both providers see the expected artwork registration' :
                waiting.role === 'OrdinaryMarket' ? 'Both providers see the expected Core ' + waiting.core + ' and NFT ' + waiting.nft :
                roleName[waiting.role] + ' · ' + waiting.address + '. Both providers see the expected Safe proxy';
            status(found + '. Waiting for Base Sepolia finality. Refresh chain evidence later.');
        }
        return true;
    }
    async function refresh() {
        busy = true; ++stateRevision; connected = undefined; wrongChain = false; plan = undefined;
        const previous = byId('data').textContent;
        byId('review').hidden = true; buttons();
        status('Verifying chain evidence…');
        try {
            const current = await fetchPlan();
            if (showOutcome(current)) return;
            plan = current;
            if (previous !== plan.data) submitted = false;
            const create = ['OrdinaryMarket', 'OrdinaryPayoutMarket'].includes(plan.operation);
            const artwork = plan.operation === 'registerArtwork';
            const opening = plan.operation === 'createAuction';
            const bid = plan.operation === 'placeBid';
            byId('operation').textContent = bid ? 'First late bid · auction 1' : opening ? 'Open the first rehearsal auction' : artwork ? 'Register rehearsal artwork' :
                create ? 'Deploy ' + plan.operation + ' and its NFT' : 'Create Safe · ' + roleName[plan.operation];
            byId('fields').replaceChildren();
            addField('Network', 'Base Sepolia · 84532');
            addField('Sender', plan.payer);
            addField('Value', bid ? '0.01 test ETH deposit plus test gas' : '0 test ETH · wallet estimates gas');
            addField('Nonce', String(BigInt(plan.nonce)));
            addField(artwork || opening || bid ? 'Reviewed Core' : create ? 'Method' : 'Safe factory', plan.target);
            if (bid) {
                addField('Work and auction', 'Work 1 · Auction 1');
                addField('Price offered', '0.001 test ETH');
                addField('Method', 'placeBid(1, 1000000000000000)');
                addField('Deadline before your bid', new Date(rehearsalLateBid.deadline * 1000).toISOString());
                addField('If included in time', 'Bidding extends by 10 minutes. If you win, settle within the payment window.');
            } else if (opening) {
                addField('Work', '1 · ' + rehearsalArtwork.title);
                addField('Method', 'createAuction(uint256,uint256,uint256)');
                addField('Starting price', '0.001 test ETH');
                addField('Duration', rehearsalOpening.hours + ' hours from inclusion');
            } else if (artwork) {
                addField('Title', rehearsalArtwork.title);
                addField('Method', 'registerArtwork(string) · no mint or auction');
                addField('Expected work', '1 if the registry is still empty at inclusion');
                addField('Metadata URI', rehearsalMetadataUri);
            } else {
                for (const [role, address] of Object.entries(plan.roles)) addField(roleName[role], address);
                addField('Safe confirmations', 'Any 2 of 3');
                plan.owners.forEach((owner, i) => addField('Signer ' + (i + 1), owner));
            }
            if (create) addField('Refund limits', '8 per batch · 30000 gas per transfer');
            plan.deployments.forEach((address, i) => addField(create ? ['Expected Core', 'Expected NFT'][i] : 'Expected Safe', address));
            addField('Calldata keccak256', plan.dataHash);
            addField('Finalized evidence block', String(BigInt(plan.block.number)));
            byId('data').textContent = plan.data;
            byId('review').hidden = false;
            status(submitted ? 'This request was already opened in your wallet. Wait for a receipt and finality.' :
                'Chain evidence verified. Review the addresses and the wallet status below.');
            if (submitted) walletStatus('Already opened in your wallet. Wait for finality before refreshing.');
            else if (selected) await recheck();
            else walletStatus(connectionHint());
        } catch (error) { status(error.message); }
        finally { busy = false; buttons(); }
    }
    byId('refresh').onclick = refresh;
    byId('connect').onclick = async () => {
        if (busy || submitted || !plan) return;
        busy = true; buttons(); connected = undefined;
        try {
            const provider = wallets.get(picker.value);
            if (!provider) throw new Error(connectionHint());
            walletStatus('Checking the selected wallet. Complete any connection request in the extension.');
            if (provider !== selected || !(await provider.request({ method: 'eth_accounts' }))?.length) {
                await provider.request({ method: 'eth_requestAccounts' });
            }
            observe(provider);
            await recheck();
        } catch (error) { walletStatus(error.message); }
        finally { busy = false; buttons(); }
    };
    byId('switch').onclick = async () => {
        if (!selected || !wrongChain || busy || submitted) return;
        busy = true; buttons();
        try {
            await selected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: testChain }] });
            await recheck();
        } catch (error) {
            walletStatus('Select Base Sepolia (84532) in the extension, then recheck the wallet. ' + error.message);
        }
        finally { busy = false; buttons(); }
    };
    byId('submit').onclick = async () => {
        if (busy || submitted || !connected) return;
        busy = true; buttons();
        try {
            const provider = connected;
            walletStatus('Checking current custody, nonce and deployment addresses…');
            const fresh = await fetchPlan();
            if (showOutcome(fresh)) return;
            check(sameReview(plan, fresh), 'Deployment or payer state changed. Refresh and review the new request.');
            const tx = await walletRequest(provider, fresh);
            submitted = true;
            status('Review and confirm the request in your wallet.');
            walletStatus('Review the confirmation in your wallet.');
            const result = await provider.request({ method: 'eth_sendTransaction', params: [tx] });
            check(/^0x[\da-f]{64}$/i.test(result), 'Wallet did not return a transaction hash. Check its activity before retrying.');
            status('Submitted · ' + result + '. Wait for finality, then refresh chain evidence.');
            walletStatus('Submitted · ' + result);
        } catch (error) {
            if (Number(error.code) === 4001) submitted = false;
            status(error.message);
            walletStatus(error.message);
        } finally { busy = false; buttons(); }
    };
    await refresh();
}

if (typeof document !== 'undefined') void start();
