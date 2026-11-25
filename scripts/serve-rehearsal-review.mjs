// A loopback review page for the C13 Base Sepolia rehearsal. Only the user's browser wallet can submit.
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { getAddress, keccak256, toQuantity } from 'ethers';
import { prepareOrdinaryDeployment } from './prepare-ordinary-deployment.mjs';
import { prepareRehearsalSafes, rehearsalSafeRelease as release } from './prepare-rehearsal-safes.mjs';
import { readRpc } from './verify-treasury-safes.mjs';

const asset = name => new URL('./rehearsal-review/' + name, import.meta.url);
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const coreName = 'contracts/replacement/OrdinaryMarket.sol:OrdinaryMarket';
const chainHex = '0x14a34';
const roles = ['protocolTreasury', 'ecosystemTreasury', 'adminSecurity'];
const sha256Hex = data => createHash('sha256').update(Buffer.from(data.slice(2), 'hex')).digest('hex');

function check(condition, message) {
    if (!condition) throw new Error(message);
}

// Bound request bursts to each public test endpoint, including concurrent wallet refreshes.
function sequencedRead(url) {
    const rpc = readRpc(url);
    let tail = Promise.resolve();
    return (method, params) => {
        const result = tail.then(() => rpc(method, params));
        tail = result.catch(() => {}).then(() => new Promise(resolve => setTimeout(resolve, 150)));
        return result;
    };
}

async function agreed(providers, method, params) {
    const [first, second] = await Promise.all(providers.map(rpc => rpc(method, params)));
    check(first === second, 'Independent RPCs disagree on ' + method + '. Refresh after the next block.');
    return first;
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

export async function buildReview({ adminSafe, payer, reference, coreReview, providers = [
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
        check(roleRequests.length === 0, 'Wait until both treasury Safes are deployed and finalized.');
        check(coreReview.chainId === 84532 && getAddress(coreReview.payer) === base.payer &&
            coreReview.constructorArgs?.slice(3).map(String).join(',') === '8,30000',
            'Expected the Base Sepolia rehearsal payer and reviewed refund limits 8 and 30000.');
        const [artifact, manifest] = await Promise.all([
            json(new URL('../artifacts/contracts/replacement/OrdinaryMarket.sol/OrdinaryMarket.json', import.meta.url)),
            json(new URL('../docs/security/C12_ORDINARY_AUDIT_MANIFEST.json', import.meta.url))
        ]);
        const entry = manifest.contracts[coreName];
        check(keccak256(artifact.bytecode) === entry.creation.keccak256 &&
            keccak256(artifact.deployedBytecode) === entry.runtimeTemplate.keccak256, 'Build differs from the C12 release manifest.');
        const plan = prepareOrdinaryDeployment(artifact, coreReview, custody);
        operation = 'OrdinaryMarket';
        target = 'Direct contract creation';
        tx = plan.transaction;
        dataHash = plan.initCodeHash;
        deployments = [plan.core, plan.nft];
        for (const role of roles.slice(0, 2)) reviewedCode.push([custody[role].address, release.proxyCodeHash]);
    } else {
        if (!roleRequests.length) return { ...base, complete: true };
        const next = roleRequests[0];
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
    const [latest, pending, payerCode, codeChecks] = await Promise.all([
        agreed(providers, 'eth_getTransactionCount', [base.payer, 'latest']),
        agreed(providers, 'eth_getTransactionCount', [base.payer, 'pending']),
        agreed(providers, 'eth_getCode', [base.payer, 'latest']),
        Promise.all(reviewedCode.map(async ([address, expected]) => {
            const code = await agreed(providers, 'eth_getCode', [address, 'latest']);
            check(keccak256(code) === expected, 'Unexpected code at ' + address);
            return { address, sha256: sha256Hex(code) };
        })),
        ...deployments.map(async address => {
            const [code, nonce] = await Promise.all([
                agreed(providers, 'eth_getCode', [address, 'latest']),
                agreed(providers, 'eth_getTransactionCount', [address, 'pending'])
            ]);
            check(code === '0x' && BigInt(nonce) === 0n, 'Deployment already exists or is pending. Wait for finality and refresh.');
        })
    ]);
    check(latest === pending && payerCode === '0x', 'Payer is not a settled externally owned account.');
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
        const [referencePath, flag, reviewPath] = process.argv.slice(2);
        check(process.argv.length === 3 || (process.argv.length === 5 && flag === '--core'),
            'Usage: node scripts/serve-rehearsal-review.mjs <private-approved-safe-plan.json> [--core <private-core-review.json>]');
        const reference = await json(referencePath);
        check(reference?.chainId === 84532 && reference?.custody?.chainId === 84532,
            'The approved Safe register must be for Base Sepolia.');
        const args = { reference, adminSafe: getAddress(reference.custody.adminSecurity.address),
            payer: getAddress(reference.payer), coreReview: reviewPath ? await json(reviewPath) : undefined };
        const result = await listenForReview(() => buildReview(args));
        console.log('Open the private Base Sepolia rehearsal page on this computer:\n' + result.url);
    } catch (error) {
        console.error(error.shortMessage ?? error.message);
        process.exitCode = 1;
    }
}
