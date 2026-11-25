const quantity = value => typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value);

export function checkReceipt(receipt, proof, transactionHash, operation = 'ordinary settlement') {
    if (receipt?.status !== '0x1' || receipt.transactionHash?.toLowerCase() !== transactionHash ||
        receipt.blockHash?.toLowerCase() !== proof.blockHash || !quantity(receipt.blockNumber) ||
        BigInt(receipt.blockNumber) !== BigInt(proof.blockNumber) || !quantity(receipt.transactionIndex) || !Array.isArray(receipt.logs)) {
        throw new Error(`Missing successful ${operation} receipt in the expected block`);
    }
}

export function receiptLogIndex(log, receipt) {
    const index = quantity(log.logIndex) ? Number(BigInt(log.logIndex)) : NaN;
    if ((log.removed !== undefined && log.removed !== false) || log.blockHash?.toLowerCase() !== receipt.blockHash.toLowerCase() ||
        log.transactionHash?.toLowerCase() !== receipt.transactionHash.toLowerCase() || log.blockNumber !== receipt.blockNumber ||
        log.transactionIndex !== receipt.transactionIndex || !Number.isSafeInteger(index)) throw new Error('Invalid settlement log position');
    return index;
}

export function decodeReceiptLog(events, name, log, receipt) {
    const index = receiptLogIndex(log, receipt);
    const args = events.decodeEventLog(name, log.data, log.topics);
    const canonical = events.encodeEventLog(name, args);
    if (canonical.data !== log.data.toLowerCase() || canonical.topics.length !== log.topics.length ||
        canonical.topics.some((word, i) => word !== log.topics[i].toLowerCase())) {
        throw new Error('Invalid settlement event encoding');
    }
    return { args, index };
}

export function verifyTransactionPosition(receipt, header, transactionHash) {
    const position = Number(BigInt(receipt.transactionIndex));
    if (!Number.isSafeInteger(position) || !Array.isArray(header.transactions) ||
        header.transactions[position]?.toLowerCase?.() !== transactionHash) {
        throw new Error('Settlement transaction is absent at its finalized block position');
    }
}
