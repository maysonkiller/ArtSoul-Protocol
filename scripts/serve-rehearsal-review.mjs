// A loopback review page for the C13 Base Sepolia rehearsal. Only the user's browser wallet can submit.
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { getAddress, keccak256, toQuantity } from 'ethers';
import { prepareOrdinaryDeployment } from './prepare-ordinary-deployment.mjs';
import { expectedRehearsalPairRegister, loadReviewedPair } from './prepare-rehearsal-core.mjs';
import { prepareRehearsalSafes, rehearsalSafeRelease as release } from './prepare-rehearsal-safes.mjs';
import { readRpc, requireIndependentProviders, verifyTreasurySafesWithTwoProviders } from './verify-treasury-safes.mjs';

const asset = name => new URL('./rehearsal-review/' + name, import.meta.url);
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const chainHex = '0x14a34';
const roles = ['protocolTreasury', 'ecosystemTreasury', 'adminSecurity'];
const sha256Hex = data => createHash('sha256').update(Buffer.from(data.slice(2), 'hex')).digest('hex');

function check(condition, message) {
    if (!condition) throw new Error(message);
}

// Bound request bursts to each public test endpoint, including concurrent wallet refreshes.
export function sequencedRead(url) {
    const rpc = readRpc(url);
    let tail = Promise.resolve();
    const read = (method, params) => {
        const result = tail.then(() => rpc(method, params));
        tail = result.catch(() => {}).then(() => new Promise(resolve => setTimeout(resolve, 150)));
        return result;
    };
    return Object.assign(read, { origin: rpc.origin });
}

async function agreed(providers, method, params) {
    const [first, second] = await Promise.all(providers.map(rpc => rpc(method, params)));
    check(first === second, 'Independent RPCs disagree on ' + method + '. Refresh after the next block.');
    return first;
}

export async function reviewedRuntimePresent(providers, address, expectedHash) {
    requireIndependentProviders(providers);
    const [code, nonce] = await Promise.all([
        agreed(providers, 'eth_getCode', [address, 'latest']),
        agreed(providers, 'eth_getTransactionCount', [address, 'pending'])
    ]);
    if (code === '0x' && BigInt(nonce) === 0n) return false;
    if (code !== '0x' && BigInt(nonce) > 0n && expectedHash && keccak256(code) === expectedHash) return true;
    throw new Error('The predicted deployment address is occupied or pending with unverified code. Refresh after finality.');
}

export async function reviewedPairStatus(providers, register, block) {
    requireIndependentProviders(providers);
    const entries = [register.core, register.nft];
    const latest = await Promise.all(entries.map(entry => reviewedRuntimePresent(providers, entry.address, entry.codeHash)));
    check(latest[0] === latest[1], 'The current block contains only part of the reviewed pair.');
    if (!latest[0]) return;
    const at = { blockHash: block.hash, requireCanonical: true };
    const finalized = await Promise.all(entries.map(entry => agreed(providers, 'eth_getCode', [entry.address, at])));
    const pair = { core: register.core.address, nft: register.nft.address };
    if (finalized.every(code => code === '0x')) return { waitingForFinality: { role: 'OrdinaryMarket', ...pair } };
    check(finalized.every((code, i) => code !== '0x' && keccak256(code) === entries[i].codeHash),
        'The finalized runtimes do not match both reviewed deployments.');
    const evidence = await verifyTreasurySafesWithTwoProviders(register, ...providers, { requirePair: true, expectedBlock: block });
    return { complete: true, finalizedPair: pair, evidence };
}

export function verifyReference(reference, plan) {
    check(reference?.chainId === 84532 && plan.chainId === 84532 && reference.payer === plan.payer,
        'Reviewed payer or chain changed. Stop and review the custody register.');
    for (const role of roles) {
        const pinned = reference.custody?.[role];
        const live = plan.custody[role];
        check(pinned?.address === live.address && pinned.threshold === 2 && live.threshold === 2 &&
            JSON.stringify(pinned.owners) === JSON.stringify(live.owners), 'The reviewed Safe or owners changed for ' + role);
    }
    for (const pending of plan.roleRequests) {
        const original = reference.roleRequests.find(item => item.role === pending.role);
        check(original?.safe === pending.safe && original.dataHash === pending.dataHash, 'The reviewed Safe request changed.');
    }
}

export function chooseTreasury(roleRequests, treasury) {
    if (treasury === undefined) return roleRequests[0];
    check(roles.slice(0, 2).includes(treasury), 'Choose protocolTreasury or ecosystemTreasury.');
    return roleRequests.find(request => request.role === treasury);
}

export async function buildReview({ adminSafe, payer, reference, coreReview, treasury, providers = [
    sequencedRead('https://sepolia.base.org'), sequencedRead('https://base-sepolia-rpc.publicnode.com')
] }) {
    const safePlan = await prepareRehearsalSafes({ adminSafe, payer, providers });
    verifyReference(reference, safePlan);
    const { custody, roleRequests, block } = safePlan;
    const summary = Object.fromEntries(roles.map(role => [role, custody[role].address]));
    const base = { chainId: chainHex, payer: safePlan.payer, roles: summary, owners: custody.adminSecurity.owners, block };
    let operation, target, tx, dataHash, deployments;
    const reviewedCode = [[release.factory, release.factoryCodeHash], [release.singleton, release.singletonCodeHash],
        [release.fallbackHandler, release.fallbackCodeHash], [adminSafe, release.proxyCodeHash]];
    if (coreReview) {
        check(treasury === undefined, 'Core review cannot select a treasury.');
        check(roleRequests.length === 0, 'Wait until both treasury Safes are deployed and finalized.');
        check(coreReview.chainId === 84532 && getAddress(coreReview.payer) === base.payer &&
            coreReview.constructorArgs?.slice(3).map(String).join(',') === '8,30000',
            'Expected the Base Sepolia rehearsal payer and reviewed refund limits 8 and 30000.');
        const { core: artifact, nft: nftArtifact, layout, manifest } = await loadReviewedPair(coreReview.contract);
        const register = expectedRehearsalPairRegister(custody, coreReview, manifest, layout, artifact, nftArtifact);
        const pairStatus = await reviewedPairStatus(providers, register, block);
        if (pairStatus) return { ...base, ...pairStatus };
        const plan = prepareOrdinaryDeployment(artifact, coreReview, custody);
        operation = artifact.contractName;
        target = 'Direct contract creation';
        tx = plan.transaction;
        dataHash = plan.initCodeHash;
        deployments = [plan.core, plan.nft];
        for (const role of roles.slice(0, 2)) reviewedCode.push([custody[role].address, release.proxyCodeHash]);
    } else {
        const next = chooseTreasury(roleRequests, treasury);
        if (!next) return { ...base, complete: true, finalizedTreasury: treasury };
        operation = next.role;
        target = release.factory;
        tx = next.transaction;
        dataHash = next.dataHash;
        deployments = [next.safe];
        check(roles.slice(0, 2).includes(operation) && tx.to === release.factory &&
            tx.data.startsWith('0x1688f0b9'), 'Unrecognized Safe factory request.');
    }
    check(tx.from === base.payer && tx.chainId === chainHex && tx.value === '0x0' &&
        keccak256(tx.data) === dataHash, 'Unrecognized rehearsal transaction.');
    const [latest, pending, payerCode, codeChecks, awaitingFinality] = await Promise.all([
        agreed(providers, 'eth_getTransactionCount', [base.payer, 'latest']),
        agreed(providers, 'eth_getTransactionCount', [base.payer, 'pending']),
        agreed(providers, 'eth_getCode', [base.payer, 'latest']),
        Promise.all(reviewedCode.map(async ([address, expected]) => {
            const code = await agreed(providers, 'eth_getCode', [address, 'latest']);
            check(keccak256(code) === expected, 'Unexpected code at ' + address);
            return { address, sha256: sha256Hex(code) };
        })),
        coreReview ? false : reviewedRuntimePresent(providers, deployments[0], release.proxyCodeHash)
    ]);
    check(latest === pending && payerCode === '0x', 'Payer is not a settled externally owned account.');
    if (awaitingFinality) return { ...base, waitingForFinality: { role: operation, address: deployments[0] } };
    const nonce = toQuantity(BigInt(pending));
    check(!coreReview || tx.nonce === nonce, 'Core payer nonce changed. A new independent review is required.');
    return { ...base, operation, target, deployments, codeChecks, nonce, dataHash, data: tx.data, dataSha256: sha256Hex(tx.data) };
}

export async function listenForReview(loadPlan) {
    const token = randomBytes(24).toString('hex');
    const prefix = '/' + token + '/';
    const files = new Map([['', ['index.html', 'text/html']], ['client.mjs', ['client.mjs', 'text/javascript']],
        ['review.css', ['review.css', 'text/css']]]);
    let inflight;
    const server = createServer(async (req, res) => {
        const host = '127.0.0.1:' + server.address().port;
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
        if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== 'http://' + host) ||
            ![undefined, 'none', 'same-origin'].includes(req.headers['sec-fetch-site']) ||
            !['GET', 'HEAD'].includes(req.method) || !req.url.startsWith(prefix)) {
            res.writeHead(403).end();
            return;
        }
        const name = req.url.slice(prefix.length);
        try {
            if (name === 'plan.json') {
                // Coalesce overlapping reads only. The wallet confirmation always requests fresh on-chain checks.
                inflight ??= Promise.resolve().then(loadPlan).finally(() => { inflight = undefined; });
                const result = await inflight;
                res.writeHead(200, { 'Content-Type': 'application/json' }).end(req.method === 'HEAD' ? undefined : JSON.stringify(result));
            } else if (files.has(name)) {
                const [file, mime] = files.get(name);
                const content = await readFile(asset(file));
                res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' }).end(req.method === 'HEAD' ? undefined : content);
            } else {
                res.writeHead(404).end();
            }
        } catch (error) {
            console.error('Review unavailable:', error.shortMessage ?? error.message);
            res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
                .end('Fresh RPC verification failed. Wait for finality and refresh. See the local terminal for details.');
        }
    });
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    return { server, url: 'http://127.0.0.1:' + server.address().port + prefix };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const [referencePath, flag, value] = process.argv.slice(2);
        check(process.argv.length === 3 || (process.argv.length === 5 && (flag === '--core' ||
            (flag === '--treasury' && roles.slice(0, 2).includes(value)))),
            'Usage: node scripts/serve-rehearsal-review.mjs <approved-safe-plan.json> [--core <core-review.json> | --treasury protocolTreasury|ecosystemTreasury]');
        const reference = await json(referencePath);
        check(reference?.chainId === 84532 && reference?.custody?.chainId === 84532,
            'The approved Safe register must be for Base Sepolia.');
        const args = { reference, adminSafe: getAddress(reference.custody.adminSecurity.address),
            payer: getAddress(reference.payer), coreReview: flag === '--core' ? await json(value) : undefined,
            treasury: flag === '--treasury' ? value : undefined };
        const result = await listenForReview(() => buildReview(args));
        console.log('Open the private Base Sepolia rehearsal page on this computer:\n' + result.url);
    } catch (error) {
        console.error(error.shortMessage ?? error.message);
        process.exitCode = 1;
    }
}
