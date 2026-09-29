// Bounded operator transactions for the existing Base Sepolia prototype only.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Interface, Wallet, getAddress, keccak256, toQuantity } from 'ethers';

const METHODS = Object.freeze({ registerArtwork: 'core', createAuction: 'core', placeBid: 'core',
    endAuction: 'core', settleAuction: 'core', listResale: 'core', buyResale: 'core', withdraw: 'core', approve: 'nft' });
const ROLES = ['creator', 'collector', 'buyer'];
export const hashPlan = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };
const integer = value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value);
const hexQuantity = value => typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value);
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
const assertNotExpired = (plan, now) => {
    if (!Number.isFinite(Date.parse(plan.expiresAt)) || Date.parse(plan.expiresAt) <= now()) fail('PLAN_EXPIRED');
};

export function validatePlan(plan, policy, address, digest, now = Date.now) {
    if (plan?.version !== 1 || policy?.version !== 1 || plan.chainId !== 84532 || policy.chainId !== 84532) fail('WRONG_CHAIN');
    if (!ROLES.includes(plan.role) || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(plan.id)) fail('INVALID_PLAN_ID');
    if (!Object.hasOwn(METHODS, plan.method) || METHODS[plan.method] !== plan.target) fail('METHOD_NOT_ALLOWED');
    if (getAddress(plan.from) !== getAddress(address)) fail('WRONG_SIGNER');
    if (!Array.isArray(policy.excludedAddresses) || policy.excludedAddresses.length === 0) fail('MISSING_EXCLUSIONS');
    if (policy.excludedAddresses.some(a => getAddress(a) === getAddress(address))) fail('PROTECTED_SIGNER');
    if (!policy.approvedPlanHashes?.includes(digest)) fail('PLAN_NOT_APPROVED');
    assertNotExpired(plan, now);
    if (!integer(plan.valueWei) || !integer(policy.limits?.maxValueWei) || BigInt(plan.valueWei) > BigInt(policy.limits.maxValueWei)) fail('VALUE_LIMIT');
    if (!Array.isArray(plan.args)) fail('INVALID_ARGUMENTS');
    if (!['placeBid', 'settleAuction', 'buyResale'].includes(plan.method) && plan.valueWei !== '0') fail('UNEXPECTED_VALUE');
    const counts = { registerArtwork: 1, createAuction: 3, placeBid: 2, endAuction: 1, settleAuction: 1, listResale: 2, buyResale: 1, withdraw: 0, approve: 2 };
    if (plan.args.length !== counts[plan.method]) fail('INVALID_ARGUMENTS');
    if (plan.method === 'registerArtwork') {
        if (typeof plan.args[0] !== 'string' || plan.args[0].length > 4096 || !/^(ipfs:\/\/|https:\/\/)/.test(plan.args[0])) fail('INVALID_METADATA_URI');
    } else if (plan.method === 'approve') {
        if (getAddress(plan.args[0]) !== getAddress(policy.contracts.core.address) || !integer(plan.args[1])) fail('INVALID_APPROVAL');
    } else if (!plan.args.every(integer)) fail('INVALID_ARGUMENTS');
    if (plan.method === 'createAuction' && !['86400', '129600', '172800'].includes(plan.args[2])) fail('INVALID_DURATION');
    if (!['registerArtwork', 'withdraw'].includes(plan.method) && (!integer(plan.artworkId) || plan.artworkId === '0')) fail('MISSING_ARTWORK_NAMESPACE');
    if (plan.method === 'createAuction' && plan.artworkId !== plan.args[0]) fail('ARTWORK_MISMATCH');
    for (const key of ['maxGasLimit', 'maxGasPriceWei', 'maxTotalReservedWei', 'l1ReserveWei']) {
        if (!integer(policy.limits[key])) fail('INVALID_LIMITS');
    }
    for (const name of ['core', 'nft']) {
        if (!/^0x[0-9a-fA-F]{64}$/.test(policy.contracts?.[name]?.codeHash)) fail('MISSING_CODE_HASH');
        getAddress(policy.contracts[name].address);
    }
    return plan;
}

function createRpc(endpoint) {
    let id = 0;
    return async (method, params = []) => {
        const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: AbortSignal.timeout(15000) });
        if (!response.ok) fail('RPC_HTTP_ERROR');
        const body = await response.json();
        if (body.error || !Object.hasOwn(body, 'result')) fail(method === 'eth_call' ? 'SIMULATION_REVERTED' : 'RPC_ERROR');
        return body.result;
    };
}

function writeRecord(file, value, exclusive = false) {
    const fd = fs.openSync(file, exclusive ? 'wx' : 'w');
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
}

async function verifiedReceipt(record, rpcs, errorCode) {
    const receipts = await Promise.all(rpcs.map(rpc => rpc('eth_getTransactionReceipt', [record.hash])));
    const fields = ['blockNumber', 'transactionIndex', 'gasUsed', 'effectiveGasPrice', 'l1Fee'];
    for (const receipt of receipts.filter(Boolean)) {
        if (receipt.transactionHash?.toLowerCase() !== record.hash.toLowerCase() ||
            receipt.from?.toLowerCase() !== record.sender.toLowerCase() || receipt.to?.toLowerCase() !== record.to.toLowerCase() ||
            !hash(receipt.blockHash) || !['0x0', '0x1'].includes(receipt.status) ||
            fields.some(field => !hexQuantity(receipt[field])) || !Array.isArray(receipt.logs)) fail(errorCode + '_IDENTITY');
        // This runner accounts for legacy execution gas and the Base L1 data fee.
        // Stop rather than undercount if a provider reports additional operator fees.
        for (const field of ['operatorFee', 'operatorFeeScalar', 'operatorFeeConstant']) {
            if (receipt[field] != null && (!hexQuantity(receipt[field]) || BigInt(receipt[field]) !== 0n)) fail('UNSUPPORTED_RECEIPT_FEE');
        }
    }
    if (receipts.some(receipt => !receipt)) return null;
    const [first, second] = receipts;
    if (first.blockHash.toLowerCase() !== second.blockHash.toLowerCase() || first.status !== second.status ||
        fields.some(field => BigInt(first[field]) !== BigInt(second[field]))) fail(errorCode + '_FIELDS');
    if (JSON.stringify(first.logs) !== JSON.stringify(second.logs)) fail(errorCode + '_LOGS');
    const blocks = await Promise.all(rpcs.map(rpc => rpc('eth_getBlockByNumber', [first.blockNumber, false])));
    // A receipt can propagate before its block is readable on the other RPC.
    // Keep confirmation pending in that case; never accept an absent header.
    if (blocks.some(block => !block)) return null;
    if (blocks.some(block => !hash(block?.hash) || block.hash.toLowerCase() !== first.blockHash.toLowerCase() ||
        !hexQuantity(block.number) || BigInt(block.number) !== BigInt(first.blockNumber))) fail(errorCode + '_BLOCK');
    return first;
}

function receiptCost(record, receipt) {
    return (receipt.status === '0x1' ? BigInt(record.valueWei) : 0n) +
        BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice) + BigInt(receipt.l1Fee);
}

async function reconcilePriorTransactions(records, sender, rpcs) {
    let minimumNonce = 0n;
    let spentWei = 0n;
    for (const record of records) {
        if (record.chainId !== 84532 || !record.sender || !record.to || !hash(record.hash) ||
            !Number.isSafeInteger(record.nonce) || record.nonce < 0 || !integer(record.valueWei) || !integer(record.reservedWei)) fail('INVALID_JOURNAL');
        getAddress(record.sender); getAddress(record.to);
        // Reconcile every role: an unresolved broadcast must not escape the campaign budget.
        const receipt = await verifiedReceipt(record, rpcs, 'PRIOR_TRANSACTION_UNRESOLVED');
        if (!receipt) fail('PRIOR_TRANSACTION_UNRESOLVED');
        const actual = receiptCost(record, receipt);
        if (actual > BigInt(record.reservedWei)) fail('ACTUAL_COST_EXCEEDS_RESERVE');
        spentWei += actual;
        if (getAddress(record.sender) === getAddress(sender)) {
            const next = BigInt(record.nonce) + 1n;
            if (next > minimumNonce) minimumNonce = next;
        }
    }
    if (minimumNonce) {
        const mined = await Promise.all(rpcs.map(rpc => rpc('eth_getTransactionCount', [sender, 'latest'])));
        if (mined.some(nonce => BigInt(nonce) < minimumNonce)) fail('PRIOR_NONCE_UNRESOLVED');
    }
    return { minimumNonce, spentWei };
}

export async function assertPriorTransactionsSettled(records, sender, rpcs) {
    return (await reconcilePriorTransactions(records, sender, rpcs)).minimumNonce;
}

// The second argument is a local test seam, never populated from CLI input.
export async function executePlan({ plan, policy, digest, privateKey, vaultPath }, runtime = {}) {
    const wallet = runtime.wallet ?? new Wallet(privateKey);
    const now = runtime.now ?? Date.now;
    const save = runtime.writeRecord ?? writeRecord;
    const wait = runtime.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    validatePlan(plan, policy, wallet.address, digest, now);
    const journal = path.join(vaultPath, 'transactions');
    fs.mkdirSync(journal, { recursive: true });
    const lockPath = path.join(journal, '.operator.lock');
    const lock = fs.openSync(lockPath, 'wx');
    const recordPath = path.join(journal, `${plan.id}.json`);
    try {
        if (fs.existsSync(recordPath)) fail('OPERATION_ALREADY_RECORDED');
        const rpcs = runtime.rpcs ?? ['https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com'].map(createRpc);
        if (rpcs.length !== 2) fail('TWO_RPCS_REQUIRED');
        const chains = await Promise.all(rpcs.map(rpc => rpc('eth_chainId')));
        if (chains.some(chain => BigInt(chain) !== 84532n)) fail('RPC_WRONG_CHAIN');
        const priorRecords = fs.readdirSync(journal).filter(file => file.endsWith('.json'))
            .map(file => JSON.parse(fs.readFileSync(path.join(journal, file), 'utf8')));
        const { minimumNonce, spentWei } = await reconcilePriorTransactions(priorRecords, wallet.address, rpcs);
        const heads = await Promise.all(rpcs.map(rpc => rpc('eth_blockNumber')));
        const height = toQuantity(BigInt(heads[0]) < BigInt(heads[1]) ? BigInt(heads[0]) : BigInt(heads[1]));
        const blocks = await Promise.all(rpcs.map(rpc => rpc('eth_getBlockByNumber', [height, false])));
        if (blocks.some(block => !hash(block?.hash) || !hexQuantity(block.number) || BigInt(block.number) !== BigInt(height)) ||
            blocks[0].hash.toLowerCase() !== blocks[1].hash.toLowerCase()) fail('RPC_BLOCK_DISAGREEMENT');
        for (const name of ['core', 'nft']) {
            const codes = await Promise.all(rpcs.map(rpc => rpc('eth_getCode', [policy.contracts[name].address, height])));
            if (codes.some(code => code === '0x' || keccak256(code) !== policy.contracts[name].codeHash)) fail('CONTRACT_CODE_CHANGED');
        }
        const abi = runtime.abi ?? (name => JSON.parse(fs.readFileSync(new URL(`../artifacts/contracts/${name}.sol/${name}.json`, import.meta.url), 'utf8')).abi);
        const interfaces = { core: new Interface(abi('ArtSoulCore')), nft: new Interface(abi('ArtSoulNFT')) };
        const read = async (method, args) => {
            const data = interfaces.core.encodeFunctionData(method, args);
            const values = await Promise.all(rpcs.map(rpc => rpc('eth_call', [{ to: policy.contracts.core.address, data }, height])));
            if (values[0] !== values[1]) fail('RPC_STATE_DISAGREEMENT');
            return interfaces.core.decodeFunctionResult(method, values[0]);
        };
        if (['placeBid', 'endAuction', 'settleAuction'].includes(plan.method)) {
            const auction = await read('auctions', [plan.args[0]]);
            if (auction.artworkId.toString() !== plan.artworkId) fail('AUCTION_ARTWORK_MISMATCH');
            if (plan.method === 'settleAuction') {
                const remaining = auction.highestBid > auction.depositLocked ? auction.highestBid - auction.depositLocked : 0n;
                if (remaining !== BigInt(plan.valueWei)) fail('SETTLEMENT_VALUE_CHANGED');
            }
        }
        if (['listResale', 'buyResale', 'approve'].includes(plan.method)) {
            const tokenId = plan.args[plan.method === 'approve' ? 1 : 0];
            if ((await read('tokenToArtwork', [tokenId]))[0].toString() !== plan.artworkId) fail('TOKEN_ARTWORK_MISMATCH');
        }
        if (plan.method === 'placeBid' && (await read('requiredDepositForBid', [plan.args[1]]))[0] !== BigInt(plan.valueWei)) fail('DEPOSIT_VALUE_MISMATCH');
        if (plan.method === 'buyResale' && (await read('resaleListings', [plan.args[0]])).price !== BigInt(plan.valueWei)) fail('LISTING_VALUE_CHANGED');
        const to = policy.contracts[plan.target].address;
        const data = interfaces[plan.target].encodeFunctionData(plan.method, plan.args);
        const request = { from: wallet.address, to, data, value: toQuantity(BigInt(plan.valueWei)) };
        const simulations = await Promise.all(rpcs.map(rpc => rpc('eth_call', [request, 'latest'])));
        if (simulations[0] !== simulations[1]) fail('SIMULATION_DISAGREEMENT');
        const estimate = BigInt(await rpcs[0]('eth_estimateGas', [request]));
        const gasLimit = (estimate * 12n + 9n) / 10n;
        const gasPrice = BigInt(await rpcs[0]('eth_gasPrice'));
        if (gasLimit > BigInt(policy.limits.maxGasLimit) || gasPrice > BigInt(policy.limits.maxGasPriceWei)) fail('GAS_LIMIT');
        // L1 reserve is an estimate, not an on-chain fee cap. Reconcile actual fees
        // before any later operation and halt on a reservation overrun.
        const reserved = BigInt(plan.valueWei) + gasLimit * gasPrice + BigInt(policy.limits.l1ReserveWei);
        if (spentWei + reserved > BigInt(policy.limits.maxTotalReservedWei)) fail('CAMPAIGN_BUDGET');
        const nonces = await Promise.all(rpcs.map(rpc => rpc('eth_getTransactionCount', [wallet.address, 'pending'])));
        if (BigInt(nonces[0]) !== BigInt(nonces[1]) || BigInt(nonces[0]) < minimumNonce) fail('NONCE_DISAGREEMENT');
        if (BigInt(await rpcs[0]('eth_getBalance', [wallet.address, 'pending'])) < reserved) fail('INSUFFICIENT_TEST_BALANCE');
        const finalChains = await Promise.all(rpcs.map(rpc => rpc('eth_chainId')));
        if (finalChains.some(chain => BigInt(chain) !== 84532n)) fail('RPC_WRONG_CHAIN');
        const transaction = { chainId: 84532, type: 0, to, data, value: BigInt(plan.valueWei),
            gasLimit, gasPrice, nonce: Number(BigInt(nonces[0])) };
        if (!Number.isSafeInteger(transaction.nonce)) fail('INVALID_NONCE');
        assertNotExpired(plan, now);
        const signed = await wallet.signTransaction(transaction);
        const transactionHash = keccak256(signed);
        const record = { version: 1, id: plan.id, planHash: digest, chainId: 84532,
            method: plan.method, role: plan.role, sender: wallet.address, artworkId: plan.artworkId ?? null,
            nonce: transaction.nonce, hash: transactionHash, to, valueWei: plan.valueWei, reservedWei: reserved.toString(),
            gasLimit: gasLimit.toString(), gasPriceWei: gasPrice.toString(), l1ReserveWei: policy.limits.l1ReserveWei,
            status: 'SIGNED_NOT_CONFIRMED', at: new Date(now()).toISOString() };
        // Record the hash before sending. A retry never silently obtains a new nonce.
        await save(recordPath, record, true);
        assertNotExpired(plan, now);
        const submitted = await rpcs[0]('eth_sendRawTransaction', [signed]);
        if (submitted.toLowerCase() !== transactionHash.toLowerCase()) fail('BROADCAST_HASH_MISMATCH');
        let receipt = null;
        for (let attempt = 0; attempt < 20; attempt++) {
            receipt = await verifiedReceipt(record, rpcs, 'RECEIPT_DISAGREEMENT');
            if (receipt) break;
            await wait(1500);
        }
        if (!receipt) return { ...record, status: 'SUBMITTED_CONFIRMATION_PENDING' };
        const events = receipt.logs.filter(log => [policy.contracts.core.address, policy.contracts.nft.address]
            .some(address => address.toLowerCase() === log.address.toLowerCase())).flatMap(log => {
                try { const parsed = interfaces[log.address.toLowerCase() === policy.contracts.core.address.toLowerCase() ? 'core' : 'nft'].parseLog(log);
                    return [{ name: parsed.name, values: parsed.args.map(value => typeof value === 'bigint' ? value.toString() : value) }]; }
                catch { return []; }
            });
        const confirmed = { ...record, status: BigInt(receipt.status) === 1n ? 'CONFIRMED' : 'REVERTED',
            blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.effectiveGasPrice,
            blockHash: receipt.blockHash, l1Fee: receipt.l1Fee, actualCostWei: receiptCost(record, receipt).toString(), events };
        // Keep the pre-broadcast journal immutable; receipt evidence is separate.
        await save(path.join(journal, `${plan.id}.receipt`), confirmed, true);
        if (BigInt(confirmed.actualCostWei) > reserved) fail('ACTUAL_COST_EXCEEDS_RESERVE');
        return confirmed;
    } finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
}

async function main() {
    if (process.argv.length !== 4) fail('INVALID_COMMAND');
    const bytes = fs.readFileSync(process.argv[2]);
    const plan = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    const policy = JSON.parse(fs.readFileSync(process.argv[3], 'utf8').replace(/^\uFEFF/, ''));
    const chunks = [];
    let length = 0;
    for await (const chunk of process.stdin) { length += chunk.length; if (length > 8192) fail('INPUT_TOO_LARGE'); chunks.push(chunk); }
    const buffer = Buffer.concat(chunks);
    let input;
    try { input = JSON.parse(buffer.toString('utf8')); } finally { buffer.fill(0); for (const chunk of chunks) chunk.fill(0); }
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).some(key => !['privateKey', 'address', 'vaultPath'].includes(key))) fail('INVALID_INPUT');
    if (getAddress(input.address) !== getAddress(plan.from)) fail('WRONG_STORED_ACCOUNT');
    const { privateKey, vaultPath } = input;
    input.privateKey = null;
    const result = await executePlan({ plan, policy, digest: hashPlan(bytes), privateKey, vaultPath });
    process.stdout.write(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => { process.stderr.write(JSON.stringify({ status: 'STOPPED', code: /^[A-Z_]{3,70}$/.test(error.message) ? error.message : 'TESTNET_OPERATION_FAILED' })); process.exitCode = 1; });
}
