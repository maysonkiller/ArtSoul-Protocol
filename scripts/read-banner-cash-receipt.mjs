import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { getAddress, Interface, isHexString, ZeroAddress, ZeroHash } from 'ethers';
import { checkReceipt, decodeReceiptLog, verifyTransactionPosition } from '../src/indexer/settlement-receipt.js';
import { confirmFinalizedBlock, finalizedBlock, readRpc, requireIndependentProviders, verifySafeAtBlock } from './verify-treasury-safes.mjs';
import { readReviewedFile } from './security/read-reviewed-file.mjs';
import { readBannerReviewSource } from './read-banner-terms.mjs';
import { readReviewedBannerTerms } from './review-banner-terms.mjs';

const chain = 84532;
const safe = new Interface([
    'event SafeReceived(address indexed sender,uint256 value)', 'event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)',
    'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures)',
    'function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256) view returns(bytes32)'
]);
const hexQuantity = value => typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value);

async function readTransfer(rpc, reviewed, cash, treasury, kind, txHash) {
    const isPayment = kind === 'payment';
    const [head, receipt] = await Promise.all([finalizedBlock(chain, rpc), rpc('eth_getTransactionReceipt', [txHash])]);
    assert(isHexString(receipt?.blockHash, 32) && receipt.blockHash !== ZeroHash && hexQuantity(receipt.blockNumber), 'Invalid receipt location');
    const block = { number: receipt.blockNumber, hash: receipt.blockHash.toLowerCase() };
    const header = await confirmFinalizedBlock(rpc, head, block);
    checkReceipt(receipt, { blockNumber: block.number, blockHash: block.hash }, txHash, 'banner transfer');
    verifyTransactionPosition(receipt, header, txHash);
    assert(hexQuantity(header.timestamp) && BigInt(header.timestamp) * 1000n > BigInt(Date.parse(reviewed.reviewedAt)), 'Transfer must follow the recorded review');
    const at = { blockHash: block.hash, requireCanonical: true };
    await verifySafeAtBlock(treasury, 'protocolTreasury', rpc, block);
    const transaction = await rpc('eth_getTransactionByHash', [txHash]);
    assert(transaction.hash?.toLowerCase() === txHash && transaction.blockHash?.toLowerCase() === block.hash &&
        transaction.blockNumber === receipt.blockNumber && transaction.transactionIndex === receipt.transactionIndex &&
        transaction.chainId && BigInt(transaction.chainId) === BigInt(chain) &&
        transaction.to?.toLowerCase() === cash.protocolTreasury && receipt.to?.toLowerCase() === cash.protocolTreasury &&
        transaction.from?.toLowerCase() === receipt.from?.toLowerCase(), 'Wrong transaction, chain or treasury');
    assert.equal(await rpc('eth_getCode', [cash.sponsorWallet, at]), '0x', 'This rehearsal supports direct sponsor wallets');
    const amount = isPayment ? (reviewed.award?.winningBidWei ?? reviewed.terms.feeWei) : cash.refundWei;
    const event = isPayment ? 'SafeReceived' : 'ExecutionSuccess';
    const logs = receipt.logs.filter(log => log.address?.toLowerCase() === cash.protocolTreasury &&
        log.topics?.[0]?.toLowerCase() === safe.getEvent(event).topicHash);
    assert.equal(logs.length, 1, 'Expected exactly one matching Safe event');
    const { args, index } = decodeReceiptLog(safe, event, logs[0], receipt);
    if (isPayment) {
        assert(transaction.from.toLowerCase() === cash.sponsorWallet && transaction.input === '0x' &&
            BigInt(transaction.value) === BigInt(amount) && BigInt(transaction.nonce) === BigInt(cash.paymentNonce) &&
            args.sender.toLowerCase() === cash.sponsorWallet && args.value === BigInt(amount), 'Different sponsor payment');
    } else {
        const call = safe.decodeFunctionData('execTransaction', transaction.input);
        assert(safe.encodeFunctionData('execTransaction', call) === transaction.input.toLowerCase() &&
            BigInt(transaction.value) === 0n && call.to.toLowerCase() === cash.sponsorWallet && call.value === BigInt(amount) &&
            call.data === '0x' && call.operation === 0n && call.safeTxGas === 0n && call.baseGas === 0n && call.gasPrice === 0n &&
            call.gasToken === ZeroAddress && call.refundReceiver === ZeroAddress && args.payment === 0n, 'Different Safe refund call or reimbursement');
        const data = safe.encodeFunctionData('getTransactionHash', [...call.slice(0, 9), BigInt(cash.refundSafeNonce)]);
        const expected = await rpc('eth_call', [{ to: cash.protocolTreasury, data }, at]);
        assert(isHexString(expected, 32) && expected.toLowerCase() !== ZeroHash && args.txHash.toLowerCase() === expected.toLowerCase(), 'Different reviewed refund nonce');
    }
    await confirmFinalizedBlock(rpc, await finalizedBlock(chain, rpc), block);
    return { kind, amountWei: amount, transactionHash: txHash, blockHash: block.hash, blockNumber: BigInt(block.number).toString(),
        transactionIndex: BigInt(receipt.transactionIndex).toString(), logIndex: index };
}

export async function verifyBannerCashReceipt({ reviewed, source, custody, providers, paymentHash, refundHash }) {
    requireIndependentProviders(providers);
    const cash = source.cashTerms;
    assert(reviewed.status === 'reviewed_terms_rehearsal' && custody?.chainId === chain &&
        custody.protocolTreasury?.threshold === 2 && custody.protocolTreasury.owners?.length === 3 &&
        cash && getAddress(custody.protocolTreasury.address).toLowerCase() === cash.protocolTreasury &&
        reviewed.revision === source.preview.revision, 'Missing matching authenticated testnet terms and Protocol Treasury');
    assert.deepEqual([reviewed.terms, reviewed.award], [source.preview.terms, source.preview.award], 'Different reviewed disclosure');
    const price = reviewed.award?.winningBidWei ?? reviewed.terms.feeWei;
    assert((reviewed.award || reviewed.terms.kind === 'negotiated') && /^(?:[1-9][0-9]{0,77})$/.test(price), 'Missing a positive reviewed cash price');
    if (refundHash !== undefined) assert(cash.refundWei && cash.refundWei === (reviewed.award ?? reviewed.terms).refundWei &&
        cash.refundSafeNonce !== undefined && BigInt(cash.refundWei) > 0n && BigInt(cash.refundWei) <= BigInt(price), 'No explicit reviewed refund');
    const results = [];
    for (const [kind, rawHash] of [['payment', paymentHash], ...(refundHash === undefined ? [] : [['refund', refundHash]])]) {
        assert(isHexString(rawHash, 32) && rawHash.toLowerCase() !== ZeroHash, 'Invalid transaction hash');
        const pair = await Promise.all(providers.map(rpc => readTransfer(rpc, reviewed, cash, custody.protocolTreasury, kind, rawHash.toLowerCase())));
        assert.deepEqual(pair[0], pair[1], 'Providers disagree on receipt evidence');
        results.push(pair[0]);
    }
    const [payment, refund] = results;
    if (refund) assert(BigInt(refund.blockNumber) > BigInt(payment.blockNumber) ||
        (refund.blockHash === payment.blockHash && BigInt(refund.transactionIndex) > BigInt(payment.transactionIndex)), 'Refund must follow the verified payment');
    return { chainId: chain, placementId: reviewed.terms.id, revision: reviewed.revision, payment, refund: refund ?? null };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    let pool;
    try {
        const [revision, placementId, custodyFile, paymentHash, refundHash, ...extra] = process.argv.slice(2);
        assert(/^[1-9]\d{0,9}$/.test(revision) && custodyFile && paymentHash && !extra.length && process.env.ARTSOUL_BANNER_DATABASE_URL);
        pool = new pg.Pool({ connectionString: process.env.ARTSOUL_BANNER_DATABASE_URL, max: 1, statement_timeout: 10000, connectionTimeoutMillis: 5000 });
        const reviewed = await readReviewedBannerTerms(pool, Number(revision), placementId);
        const source = await readBannerReviewSource(pool, Number(revision), placementId);
        const custody = JSON.parse(await readReviewedFile(custodyFile, 65536));
        const providers = [process.env.ARTSOUL_CUSTODY_RPC_URL, process.env.ARTSOUL_CUSTODY_RPC_CHECK_URL].map(readRpc);
        console.log(JSON.stringify(await verifyBannerCashReceipt({ reviewed, source, custody, providers, paymentHash, refundHash }), null, 2));
    } catch {
        console.error('Could not verify the reviewed testnet banner payment or refund. Check the revision, cash terms, custody register and two independent RPCs.');
        process.exitCode = 1;
    } finally { await pool?.end(); }
}
