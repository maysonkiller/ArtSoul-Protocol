import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { Contract, FetchRequest, Interface, JsonRpcProvider, ZeroAddress, getAddress, keccak256 } from 'ethers';
import { openKeeperStore } from './auction-keeper-discovery.mjs';
import { readOrdinaryRunnerUpOffers } from '../src/indexer/nft-deployment-proof.js';

const lifecycle = [null, 'closeAuction', 'finalizeDefault', 'expireRunnerUpOffer'];
const abi = new Interface([
    'function dueAuctionAction(uint256 id) view returns (uint8)',
    ...lifecycle.slice(1).map(name => `function ${name}(uint256 id)`)
]);
const localChain = 31337;
const batchSize = 16;

class KeeperConfigurationError extends Error {}

function check(value, message) {
    if (!value) throw new KeeperConfigurationError(message);
}

export function validateKeeperConfig(config) {
    check([8453, 84532, localChain].includes(config.chainId), 'Unsupported keeper chain');
    check(getAddress(config.engine) !== ZeroAddress && /^0x[0-9a-fA-F]{64}$/.test(config.codeHash), 'Invalid deployment pin');
    check(Number.isSafeInteger(config.startBlock) && config.startBlock > 0, 'Expected the engine creation block');
    for (const [setting, maximum] of [['logBlockRange', 5000], ['rangesPerCycle', 10]]) {
        const value = config[setting];
        check(value === undefined || (Number.isSafeInteger(value) && value > 0 && value <= maximum), 'Invalid ' + setting);
    }
}

export function validateKeeperEndpoint(endpoint, chainId, executeLocal) {
    const url = new URL(endpoint);
    if (chainId === localChain) {
        check(['http:', 'https:'].includes(url.protocol) &&
            ['127.0.0.1', '[::1]'].includes(url.hostname), 'Local rehearsal requires a loopback RPC');
    } else {
        check(!executeLocal && url.protocol === 'https:', 'Base networks use read-only HTTPS');
    }
}

export function checkKeeperAgainstMainnetCustody(operator, register) {
    const gasWallet = getAddress(operator);
    check(register.chainId === 8453 && gasWallet !== ZeroAddress, 'Expected the mainnet custody register and a dedicated gas wallet');
    for (const role of ['protocolTreasury', 'ecosystemTreasury', 'adminSecurity']) {
        const safe = register[role];
        check(Array.isArray(safe?.owners) && safe.owners.length >= 2, 'Missing mainnet Safe owner list');
        check([safe.address, ...safe.owners].every(address => getAddress(address) !== gasWallet), 'Keeper overlaps a mainnet Safe or signer');
    }
}

export async function runKeeperCycle({ provider, store, config, executeLocal = false, submitter, runnerUpPair, afterAuction = '0' }) {
    validateKeeperConfig(config);
    if (runnerUpPair) {
        check(!submitter && !executeLocal && [8453, 84532].includes(config.chainId), 'Runner-up observation requires read-only Base mode');
        check(runnerUpPair.chainId === config.chainId && getAddress(runnerUpPair.coreAddress) === getAddress(config.engine) &&
            runnerUpPair.expectedCoreCodeHash?.toLowerCase() === config.codeHash.toLowerCase(), 'Runner-up pair differs from keeper deployment');
    }
    check(!submitter || (!executeLocal && config.chainId === 84532), 'Testnet submissions require Base Sepolia');
    check(BigInt(await provider.send('eth_chainId', [])) === BigInt(config.chainId), 'Keeper RPC chain mismatch');
    if (executeLocal) {
        check(config.chainId === localChain && getAddress(config.operator) !== ZeroAddress, 'Expected a local rehearsal operator');
        const meta = await provider.send('hardhat_metadata', []);
        check(Number(meta.chainId) === localChain && !meta.forkedNetwork, 'Use an isolated Hardhat chain');
    }
    const tip = await provider.getBlock(config.chainId === localChain ? 'latest' : 'finalized');
    check(tip && tip.number >= config.startBlock, 'Engine creation block is not confirmed yet');
    const code = await provider.getCode(config.engine, tip.number);
    check(code !== '0x' && keccak256(code) === config.codeHash.toLowerCase(), 'Keeper engine runtime mismatch');
    const progress = await store.sync(provider, tip.number, { blockRange: config.logBlockRange, maxRanges: config.rangesPerCycle });
    const actions = [];
    if (runnerUpPair) {
        if (!progress.caughtUp) return { ...progress, actions, runnerUpOffers: null };
        const { ids, nextAfterAuction } = store.offerCandidates(tip, afterAuction, batchSize);
        const listener = { chainId: config.chainId, contractAddress: config.engine, nftAddress: runnerUpPair.nftAddress,
            _readRpcCall: read => read(provider) };
        const page = await readOrdinaryRunnerUpOffers(listener, { ...runnerUpPair, blockNumber: tip.number, blockHash: tip.hash,
            isCurrent: () => true }, ids);
        const offers = page.offers.filter(offer => offer.status === 'open').map(({auctionId, artworkId, eligibleBuyer, priceWei, deadline}) =>
            ({auctionId, artworkId, runnerUp: eligibleBuyer, priceWei, deadline}));
        return { ...progress, actions, runnerUpOffers: {chainId:page.chainId, coreAddress:page.coreAddress, nftAddress:page.nftAddress,
            blockNumber:page.blockNumber, blockHash:page.blockHash, offers, nextAfterAuction} };
    }
    if (submitter) {
        const pending = await submitter.reconcile();
        if (pending) return { ...progress, actions: [pending] };
    }
    if (!progress.caughtUp) return { ...progress, actions };

    const engine = new Contract(config.engine, abi, provider);
    // Index finalized events, but use current chain time to wake a known auction at its deadline.
    const now = config.chainId === localChain ? tip.timestamp : (await provider.getBlock('latest')).timestamp;
    const due = store.ready(now, batchSize);
    for (const row of due) {
        const { id, action } = row;
        const entry = { id: id.toString(), action };
        if (lifecycle[Number(await engine.dueAuctionAction(id))] !== action) {
            actions.push({ ...entry, status: 'changed' });
            store.postpone(id, now + 60);
            continue;
        }
        if (submitter) {
            const result = await submitter.submit({ id, action });
            actions.push(result);
            if (['changed', 'simulation-rejected', 'gas-cap'].includes(result.status)) store.postpone(id, now + 60);
            break;
        }
        if (!executeLocal) {
            actions.push({ ...entry, status: 'preview', to: config.engine, value: '0', data: abi.encodeFunctionData(action, [id]) });
            if (due.length === batchSize) store.postpone(id, now + 60);
            continue;
        }
        const signer = await provider.getSigner(config.operator);
        const address = await signer.getAddress();
        const nonce = await provider.getTransactionCount(address, 'latest');
        if (await provider.getTransactionCount(address, 'pending') !== nonce) {
            actions.push({ ...entry, status: 'pending' });
            break;
        }
        const operation = engine.connect(signer)[action];
        try {
            await operation.staticCall(id, { value: 0n });
        } catch (error) {
            if (error.code !== 'CALL_EXCEPTION') throw error;
            actions.push({ ...entry, status: 'simulation-rejected' });
            store.postpone(id, now + 60);
            continue;
        }
        const tx = await operation(id, { nonce, value: 0n });
        const receipt = await tx.wait(1, 30000);
        check(receipt?.status === 1, 'Keeper transaction was not confirmed');
        actions.push({ ...entry, status: 'confirmed', hash: tx.hash });
        break;
    }
    return { ...progress, actions };
}

async function main() {
    const { values } = parseArgs({ options: {
        config: { type: 'string' }, state: { type: 'string' }, once: { type: 'boolean' },
        'local-execute': { type: 'boolean' }, 'testnet-execute': { type: 'boolean' }, outbox: { type: 'string' },
        custody: { type: 'string' }, 'runner-up-pair': { type: 'string' }, 'after-auction': { type: 'string' }
    } });
    check(values.config && values.state, 'Supply --config <deployment.json> and --state <local.sqlite>');
    const config = JSON.parse(await readFile(values.config, 'utf8'));
    validateKeeperConfig(config);
    const observeOffers = values['runner-up-pair'] !== undefined;
    check(values['after-auction'] === undefined || observeOffers, '--after-auction requires --runner-up-pair');
    let runnerUpPair;
    if (observeOffers) {
        check(values.once && !values['local-execute'] && !values['testnet-execute'],
            'Runner-up observation requires --once and cannot execute');
        check(values['runner-up-pair'], 'Supply a reviewed runner-up pair file');
        runnerUpPair = JSON.parse(await readFile(values['runner-up-pair'], 'utf8'));
        check(runnerUpPair && typeof runnerUpPair === 'object', 'Expected reviewed runner-up pair');
    }
    const endpoint = process.env.ARTSOUL_KEEPER_RPC_URL;
    check(endpoint, 'Set ARTSOUL_KEEPER_RPC_URL');
    validateKeeperEndpoint(endpoint, config.chainId, values['local-execute']);
    if (values['testnet-execute']) {
        check(config.chainId === 84532 && !values['local-execute'], 'Testnet execution requires Base Sepolia');
        check(values.outbox && resolve(values.outbox) !== resolve(values.state), 'Supply a separate --outbox database');
        check(values.custody, 'Supply --custody with the current public Safe addresses and owners');
        checkKeeperAgainstMainnetCustody(config.operator, JSON.parse(await readFile(values.custody, 'utf8')));
    }
    const transport = new FetchRequest(endpoint);
    transport.timeout = 15000;
    const provider = new JsonRpcProvider(transport, undefined, { cacheTimeout: -1 });
    const stop = new AbortController();
    const shutdown = () => stop.abort();
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    let store, submitter;
    try {
        check(BigInt(await provider.send('eth_chainId', [])) === BigInt(config.chainId), 'Keeper RPC chain mismatch');
        const deploymentCode = await provider.getCode(config.engine, config.startBlock);
        check(deploymentCode !== '0x' && keccak256(deploymentCode) === config.codeHash.toLowerCase() &&
            await provider.getCode(config.engine, config.startBlock - 1) === '0x', 'Invalid engine creation block or bytecode');
        store = openKeeperStore(values.state, config);
        if (values['testnet-execute']) {
            const { openTestnetSubmitter } = await import('./auction-keeper-testnet.mjs');
            submitter = await openTestnetSubmitter({ provider, config, statePath: values.outbox,
                keystorePath: process.env.ARTSOUL_KEEPER_KEYSTORE_FILE,
                passwordPath: process.env.ARTSOUL_KEEPER_PASSWORD_FILE });
        }
        let failures = 0, lastReportAt = 0, lastOutcome;
        while (!stop.signal.aborted) {
            let delay = 60000;
            try {
                const result = await runKeeperCycle({ provider, store, config, executeLocal: values['local-execute'], submitter,
                    runnerUpPair, afterAuction: values['after-auction'] });
                const outcome = JSON.stringify([result.caughtUp, result.actions]);
                if (values.once || failures || outcome !== lastOutcome || Date.now() - lastReportAt >= 3600000) {
                    console.log(JSON.stringify(result));
                    lastReportAt = Date.now();
                    lastOutcome = outcome;
                }
                failures = 0;
                if (!result.caughtUp) delay = 1000;
            } catch (error) {
                if (values.once) throw error;
                failures++;
                delay = Math.min(300000, 15000 * 2 ** Math.min(failures - 1, 5));
                const message = error instanceof KeeperConfigurationError ? error.message : 'Check the deployment pin, checkpoint, outbox and RPC';
                console.error(message + '. Retrying in ' + delay / 1000 + 's.');
            }
            if (values.once || stop.signal.aborted) break;
            await sleep(delay, undefined, { signal: stop.signal }).catch(error => {
                if (error.name !== 'AbortError') throw error;
            });
        }
    } finally {
        process.off('SIGINT', shutdown);
        process.off('SIGTERM', shutdown);
        try { submitter?.close(); } finally {
            try { store?.close(); } finally { provider.destroy(); }
        }
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => {
        // Provider errors can contain the private RPC URL or its credentials.
        console.error(error instanceof KeeperConfigurationError ? error.message : 'Check keeper configuration, local files and RPC');
        process.exitCode = 1;
    });
}
