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

export async function matchWallet(provider, plan) {
    const [chain, accounts] = await Promise.all([
        provider.request({ method: 'eth_chainId' }), provider.request({ method: 'eth_accounts' })
    ]);
    check(chain === testChain && plan.chainId === testChain, 'Select Base Sepolia (84532) in your wallet.');
    check(sameAddress(accounts?.[0], plan.payer), 'Select the displayed test payer in your wallet.');
}

export async function walletRequest(provider, plan) {
    const rpc = (method, params) => provider.request({ method, params });
    await matchWallet(provider, plan);
    check(['protocolTreasury', 'ecosystemTreasury', 'OrdinaryMarket'].includes(plan.operation), 'Unknown rehearsal operation.');
    const create = plan.operation === 'OrdinaryMarket';
    check(create ? plan.target === 'Direct contract creation' :
        sameAddress(plan.target, factory) && plan.data.startsWith('0x1688f0b9'), 'Unexpected transaction target or method.');
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
    await matchWallet(provider, plan);
    const tx = { from: plan.payer, chainId: testChain, nonce: plan.nonce, value: '0x0', data: plan.data };
    if (!create) tx.to = plan.target;
    return tx;
}

export function sameReview(first, next) {
    return !next.complete && first.chainId === next.chainId && first.operation === next.operation &&
        first.payer === next.payer && first.nonce === next.nonce && first.target === next.target &&
        first.dataHash === next.dataHash && first.dataSha256 === next.dataSha256 &&
        JSON.stringify(first.deployments) === JSON.stringify(next.deployments) &&
        JSON.stringify(first.owners) === JSON.stringify(next.owners) && JSON.stringify(first.roles) === JSON.stringify(next.roles);
}

export async function start() {
    const byId = id => document.getElementById(id);
    const status = message => { byId('status').textContent = message; };
    const picker = byId('wallet');
    const wallets = new Map();
    let plan, connected, busy = false, submitted = false;
    function buttons() {
        picker.disabled = busy || submitted;
        byId('connect').disabled = busy || submitted || !plan || !wallets.size;
        byId('submit').disabled = busy || submitted || !connected;
        byId('refresh').disabled = busy;
    }
    function register(id, name, provider) {
        if (typeof id !== 'string' || typeof name !== 'string' || !provider?.request ||
            wallets.has(id) || [...wallets.values()].includes(provider)) return;
        wallets.set(id, provider);
        picker.add(new Option(name, id));
        buttons();
    }
    window.addEventListener('eip6963:announceProvider', event => {
        const { info, provider } = event.detail ?? {};
        register(info?.uuid, info?.name, provider);
    });
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    if (!wallets.size) register('injected', 'Browser wallet', window.ethereum);
    picker.onchange = () => { connected = undefined; buttons(); };
    function addField(label, value) {
        const dt = document.createElement('dt'), dd = document.createElement('dd');
        dt.textContent = label; dd.textContent = value; byId('fields').append(dt, dd);
    }
    async function fetchPlan() {
        const response = await fetch('./plan.json', { cache: 'no-store', credentials: 'omit' });
        if (!response.ok) throw new Error(await response.text());
        return response.json();
    }
    async function refresh() {
        busy = true; connected = undefined; plan = undefined;
        const previous = byId('data').textContent;
        byId('review').hidden = true; buttons();
        status('Verifying chain evidence…');
        try {
            const current = await fetchPlan();
            if (current.complete) { status('Both treasury Safes were verified at a finalized block.'); return; }
            plan = current;
            if (previous !== plan.data) submitted = false;
            const create = plan.operation === 'OrdinaryMarket';
            byId('operation').textContent = create ? 'Deploy OrdinaryMarket and its NFT' : 'Create Safe · ' + roleName[plan.operation];
            byId('fields').replaceChildren();
            addField('Network', 'Base Sepolia · 84532');
            addField('Sender', plan.payer);
            addField('Value', '0 test ETH · wallet estimates gas');
            addField('Nonce', String(BigInt(plan.nonce)));
            addField(create ? 'Method' : 'Safe factory', plan.target);
            for (const [role, address] of Object.entries(plan.roles)) addField(roleName[role], address);
            addField('Safe confirmations', 'Any 2 of 3');
            plan.owners.forEach((owner, i) => addField('Signer ' + (i + 1), owner));
            if (create) addField('Refund limits', '8 per batch · 30000 gas per transfer');
            plan.deployments.forEach((address, i) => addField(create ? ['Expected Core', 'Expected NFT'][i] : 'Expected Safe', address));
            addField('Calldata keccak256', plan.dataHash);
            addField('Finalized evidence block', String(BigInt(plan.block.number)));
            byId('data').textContent = plan.data;
            byId('review').hidden = false;
            status(submitted ? 'This request was already opened in your wallet. Wait for a receipt and finality.' :
                'Review the addresses and choose the wallet that holds the displayed test payer.');
        } catch (error) { status(error.message); }
        finally { busy = false; buttons(); }
    }
    byId('refresh').onclick = refresh;
    byId('connect').onclick = async () => {
        if (busy || submitted) return;
        busy = true; buttons(); connected = undefined;
        try {
            const provider = wallets.get(picker.value);
            await provider.request({ method: 'eth_requestAccounts' });
            await matchWallet(provider, plan);
            connected = provider;
            status('Payer and network match. Select Review in wallet to see the confirmation.');
        } catch (error) { status(error.message); }
        finally { busy = false; buttons(); }
    };
    byId('submit').onclick = async () => {
        if (busy || submitted || !connected) return;
        busy = true; buttons();
        try {
            const provider = connected;
            const fresh = await fetchPlan();
            check(sameReview(plan, fresh), 'Deployment or payer state changed. Refresh and review the new request.');
            const tx = await walletRequest(provider, fresh);
            submitted = true;
            status('Review and confirm the request in your wallet.');
            const result = await provider.request({ method: 'eth_sendTransaction', params: [tx] });
            check(/^0x[\da-f]{64}$/i.test(result), 'Wallet did not return a transaction hash. Check its activity before retrying.');
            status('Submitted · ' + result + '. Wait for finality, then refresh chain evidence.');
        } catch (error) {
            if (Number(error.code) === 4001) submitted = false;
            status(error.message);
        } finally { busy = false; buttons(); }
    };
    await refresh();
}

if (typeof document !== 'undefined') void start();
