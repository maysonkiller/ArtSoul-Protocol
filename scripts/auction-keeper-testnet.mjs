import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { Interface, MaxUint256, Transaction, Wallet, ZeroAddress, getAddress, isHexString, isKeystoreJson, keccak256 } from 'ethers';

const chain = 84532;
const actions = [null, 'closeAuction', 'finalizeDefault', 'expireRunnerUpOffer'];
const roles = ['protocolTreasury', 'ecosystemTreasury', 'adminSecurity'];
const abi = new Interface([
    ...actions.slice(1).map(name => `function ${name}(uint256 id)`),
    ...roles.map(name => `function ${name}() view returns (address)`),
    'function getOwners() view returns (address[])',
    'function dueAuctionAction(uint256 id) view returns (uint8)',
    'function auctions(uint256 id) view returns (uint256,uint256,uint256,uint256,uint256,address highestBidder,uint256,uint256,uint8,address)'
]);

function requireThat(value, message) {
    if (!value) throw new Error(message);
}

function positive(value, name) {
    requireThat(typeof value === 'string' && /^[1-9][0-9]*$/.test(value) ||
        Number.isSafeInteger(value) && value > 0, 'Invalid ' + name);
    const amount = BigInt(value);
    requireThat(amount <= MaxUint256, 'Invalid ' + name);
    return amount;
}

// The send path is intentionally restricted to a dedicated, manually funded Base Sepolia EOA.
export async function openTestnetSubmitter({ config, provider, statePath, keystorePath, passwordPath }) {
    requireThat(config.chainId === chain, 'Testnet execution requires Base Sepolia');
    const operator = getAddress(config.operator);
    const engine = getAddress(config.engine);
    requireThat(operator !== ZeroAddress && engine !== ZeroAddress && operator !== engine && isHexString(config.codeHash, 32),
        'Invalid testnet operator or engine pin');
    const codeHash = config.codeHash.toLowerCase();
    const gasLimit = positive(config.gasLimit, 'gas limit');
    const feeCap = positive(config.maxFeePerGasWei, 'maximum fee per gas');
    const dailyCap = config.maxDailyAttempts;
    requireThat(Number.isSafeInteger(dailyCap) && dailyCap > 0, 'Invalid maximum daily attempts');
    requireThat(typeof statePath === 'string' && statePath && statePath !== ':memory:', 'Persistent keeper state required');

    async function read(to, name, args = [], blockTag = 'latest') {
        const data = abi.encodeFunctionData(name, args);
        return abi.decodeFunctionResult(name, await provider.call({ to, data, blockTag }));
    }
    async function verifyAuthority() {
        requireThat(BigInt(await provider.send('eth_chainId', [])) === BigInt(chain), 'Testnet RPC chain mismatch');
        const code = await provider.getCode(engine);
        requireThat(code !== '0x' && keccak256(code) === codeHash, 'Testnet engine runtime mismatch');
        requireThat(await provider.getCode(operator) === '0x', 'Testnet operator must be a plain EOA');
        const safes = await Promise.all(roles.map(async role => (await read(engine, role))[0]));
        requireThat(safes.every(safe => safe !== operator && safe !== ZeroAddress) && new Set(safes).size === roles.length,
            'Invalid testnet custody accounts');
        for (const safe of safes) {
            const [owners] = await read(safe, 'getOwners');
            requireThat(owners.length >= 2 && !owners.includes(operator), 'Testnet operator must be independent of Safe owners');
        }
    }
    async function isDue(id, action) {
        const [due] = await read(engine, 'dueAuctionAction', [id]);
        if (actions[Number(due)] !== action) return false;
        if (action !== 'closeAuction') return true;
        return (await read(engine, 'auctions', [id])).highestBidder !== ZeroAddress;
    }

    await verifyAuthority();
    const json = await readFile(keystorePath, 'utf8');
    requireThat(isKeystoreJson(json), 'Dedicated testnet keystore must be Ethereum V3');
    const declared = JSON.parse(json).address;
    requireThat(typeof declared === 'string' && /^(?:0x)?[0-9a-f]{40}$/i.test(declared) &&
        getAddress('0x' + declared.replace(/^0x/i, '').toLowerCase()) === operator, 'Unexpected testnet keystore address');
    let wallet;
    try {
        const password = await readFile(passwordPath);
        try {
            // Accept the newline added by a secret-file writer while preserving all other password bytes.
            const end = password.at(-1) !== 10 ? password.length : password.at(-2) === 13 ? -2 : -1;
            const keyPassword = password.subarray(0, end);
            requireThat(keyPassword.length > 0, 'An encrypted testnet keystore needs a password');
            wallet = await Wallet.fromEncryptedJson(json, keyPassword);
        } finally { password.fill(0); }
    } catch { throw new Error('Unable to decrypt dedicated testnet keystore'); }
    requireThat(wallet.address === operator, 'Dedicated keystore address differs from configured operator');

    const db = new DatabaseSync(statePath);
    try {
        db.exec(`
            PRAGMA busy_timeout=5000;
            PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS keeper_signer (
                slot INTEGER PRIMARY KEY CHECK(slot=1), chain INTEGER NOT NULL, engine TEXT NOT NULL,
                code_hash TEXT NOT NULL, operator TEXT NOT NULL, day INTEGER NOT NULL DEFAULT -1,
                attempts INTEGER NOT NULL DEFAULT 0, last_nonce INTEGER NOT NULL DEFAULT -1
            );
            CREATE TABLE IF NOT EXISTS keeper_outbox (
                slot INTEGER PRIMARY KEY CHECK(slot=1), id TEXT NOT NULL, action TEXT NOT NULL,
                nonce INTEGER NOT NULL, hash TEXT NOT NULL, raw TEXT NOT NULL
            );`);
        db.prepare('INSERT OR IGNORE INTO keeper_signer(slot,chain,engine,code_hash,operator) VALUES (1,?,?,?,?)')
            .run(chain, engine, codeHash, operator);
        const saved = db.prepare('SELECT * FROM keeper_signer WHERE slot=1').get();
        requireThat(saved.chain === chain && saved.engine === engine && saved.code_hash === codeHash && saved.operator === operator,
            'Testnet signing state belongs to a different deployment or operator');
    } catch (error) { db.close(); throw error; }

    const pending = db.prepare('SELECT * FROM keeper_outbox WHERE slot=1');
    const remove = db.prepare('DELETE FROM keeper_outbox WHERE slot=1 AND hash=?');
    function transaction(change) {
        db.exec('BEGIN IMMEDIATE');
        try {
            const result = change();
            db.exec('COMMIT');
            return result;
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    }
    function reserve(row, day) {
        return transaction(() => {
            const budget = db.prepare('SELECT * FROM keeper_signer WHERE slot=1').get();
            if (pending.get()) return 'pending';
            if (day < budget.day || (day === budget.day && budget.attempts >= dailyCap)) return 'daily-cap';
            if (row.nonce <= budget.last_nonce) return 'nonce-conflict';
            db.prepare('UPDATE keeper_signer SET day=?,attempts=?,last_nonce=? WHERE slot=1')
                .run(day, day === budget.day ? budget.attempts + 1 : 1, row.nonce);
            db.prepare('INSERT INTO keeper_outbox(slot,id,action,nonce,hash,raw) VALUES(1,?,?,?,?,?)')
                .run(row.id, row.action, row.nonce, row.hash, row.raw);
            return null;
        });
    }
    function verifyEnvelope(row) {
        const tx = Transaction.from(row.raw);
        requireThat(actions.slice(1).includes(row.action) && tx.hash === row.hash && tx.chainId === BigInt(chain) &&
            tx.type === 2 && tx.from === operator && tx.to === engine && tx.nonce === row.nonce && tx.value === 0n &&
            tx.data === abi.encodeFunctionData(row.action, [row.id]) && tx.accessList.length === 0,
        'Invalid testnet outbox transaction');
        return tx;
    }
    async function irrevocablyPassed(row) {
        const finalized = await provider.getBlock('finalized');
        if (!finalized) return false;
        const auction = await read(engine, 'auctions', [row.id], finalized.number);
        const state = Number(auction[8]);
        const terminal = [3, 4, 5].includes(state); // NoBids, Settled, Defaulted
        if (row.action === 'closeAuction') {
            return terminal || state === 2 || state === 6 ||
                (state === 1 && auction.highestBidder === ZeroAddress && auction[3] <= BigInt(finalized.timestamp));
        }
        if (row.action === 'finalizeDefault') return terminal || state === 6;
        return terminal;
    }
    async function reconcile() {
        const row = pending.get();
        if (!row) return null;
        await verifyAuthority();
        const tx = verifyEnvelope(row);
        const result = { id: row.id, action: row.action, hash: row.hash };
        const receipt = await provider.getTransactionReceipt(row.hash);
        if (receipt) {
            requireThat(receipt.hash === row.hash && [0, 1].includes(receipt.status), 'Invalid testnet receipt');
            const finalized = await provider.getBlock('finalized');
            if (!finalized || finalized.number < receipt.blockNumber ||
                (await provider.getBlock(receipt.blockNumber))?.hash !== receipt.blockHash) {
                return { ...result, status: 'pending' };
            }
            remove.run(row.hash);
            return { ...result, status: receipt.status === 1 ? 'confirmed' : 'reverted' };
        }
        const [latest, queued] = await Promise.all(['latest', 'pending'].map(tag => provider.getTransactionCount(operator, tag)));
        if (latest > row.nonce && await provider.getTransactionCount(operator, 'finalized') > row.nonce) {
            remove.run(row.hash);
            return { ...result, status: 'nonce-consumed' };
        }
        if (await provider.getTransaction(row.hash)) return { ...result, status: 'pending' };
        if (latest !== row.nonce || queued !== row.nonce) return { ...result, status: 'nonce-conflict' };
        if (!await isDue(row.id, row.action)) {
            if (!await irrevocablyPassed(row)) return { ...result, status: 'stale-pending' };
            // A now-invalid signed call can only compete for this nonce. Any subsequent reservation
            // rechecks the mempool and signs the next permitted call at the same still-unused nonce.
            transaction(() => {
                if (remove.run(row.hash).changes) {
                    db.prepare('UPDATE keeper_signer SET last_nonce=? WHERE slot=1 AND last_nonce=?')
                        .run(row.nonce - 1, row.nonce);
                }
            });
            return { ...result, status: 'superseded' };
        }
        if (tx.gasLimit > gasLimit || tx.maxFeePerGas > feeCap) return { ...result, status: 'fee-cap' };
        if (pending.get()?.hash !== row.hash) return { ...result, status: 'changed' };
        const sent = await provider.broadcastTransaction(row.raw);
        requireThat(sent.hash === row.hash, 'Testnet RPC returned a different transaction hash');
        return { ...result, status: 'submitted' };
    }

    async function submit({ id, action }) {
        requireThat(actions.slice(1).includes(action), 'Unsupported testnet lifecycle action');
        const auction = BigInt(id);
        requireThat(auction > 0n && auction <= MaxUint256, 'Invalid auction ID');
        const existing = await reconcile();
        if (existing) return existing;
        await verifyAuthority();
        const result = { id: String(auction), action };
        if (!await isDue(auction, action)) return { ...result, status: 'changed' };
        const nonce = await provider.getTransactionCount(operator, 'latest');
        if (nonce !== await provider.getTransactionCount(operator, 'pending')) return { ...result, status: 'nonce-conflict' };
        const request = { from: operator, to: engine, value: 0n, data: abi.encodeFunctionData(action, [auction]) };
        const fees = await provider.getFeeData();
        if (fees.maxFeePerGas == null || fees.maxFeePerGas <= 0n || fees.maxFeePerGas > feeCap ||
            fees.maxPriorityFeePerGas == null || fees.maxPriorityFeePerGas < 0n ||
            fees.maxPriorityFeePerGas > fees.maxFeePerGas) return { ...result, status: 'fee-cap' };
        try {
            await provider.call(request);
            if (await provider.estimateGas(request) > gasLimit) return { ...result, status: 'gas-cap' };
        } catch (error) {
            if (error.code === 'CALL_EXCEPTION') return { ...result, status: 'simulation-rejected' };
            throw error;
        }
        const tip = await provider.getBlock('latest');
        requireThat(tip && Number.isSafeInteger(tip.timestamp) && tip.timestamp > 0, 'Missing testnet block timestamp');
        const raw = await wallet.signTransaction({ ...request, chainId: chain, type: 2, nonce, gasLimit,
            maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
        const blocked = reserve({ ...result, raw, hash: keccak256(raw), nonce }, Math.floor(tip.timestamp / 86400));
        if (blocked) return { ...result, status: blocked };
        return (await reconcile()) ?? { ...result, status: 'changed' };
    }
    return { submit, reconcile, close() { db.close(); wallet = undefined; } };
}
