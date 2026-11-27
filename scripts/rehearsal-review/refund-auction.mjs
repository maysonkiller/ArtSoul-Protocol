// These two Base Sepolia collectors previously signed the first and second bids on auction 66.
export const refundCollectors = Object.freeze([
    '0x316014C808f64CF731b4E51Bd32F61f2E52D1819', '0xb7553cd3377817186DFB36beF1C3118540911efb'
]);
export const refundOpeningHash = '0x87883da08e3404683f3ae7ed4c7912ba091562d5d11b33152becf1dc25219f8d';
export const refundStages = Object.freeze(['first', 'outbid', 'close', 'refund']);
const word = value => BigInt(value).toString(16).padStart(64, '0');
const reserve = 1000000000000000n, increment = 10000000000000000n, deposit = 10000000000000000n;
const calls = { auction: '0x571a26a0', progress: '0xf7e4e049', due: '0x25b43a14',
    minimum: '0xfea32600', deposit: '0x6ff27571', placeBid: '0x57c90de5', closeAuction: '0x236ed8f3', processRefunds: '0x28539be9' };

export async function refundRequestAt(rpc, core, stage, at) {
    if (!refundStages.includes(stage)) throw Error('Unknown two-collector review step.');
    async function read(method, arg, length) {
        const raw = await rpc('eth_call', [{ to: core, data: calls[method] + word(arg) }, at]);
        if (typeof raw !== 'string' || !/^0x[0-9a-f]+$/i.test(raw) || raw.length !== 2 + 64 * length) {
            throw Error('Invalid two-collector auction response.');
        }
        return raw.slice(2).match(/.{64}/g).map(value => BigInt('0x' + value));
    }
    const [auction, [cursor, total], [due]] = await Promise.all([read('auction', 2, 10), read('progress', 2, 2), read('due', 2, 1)]);
    const [work, start, , end, , leader, price, locked, state] = auction;
    if (work !== 2n || start !== reserve || cursor > total) throw Error('Unexpected auction 2 terms or refund queue.');
    const [first, second] = refundCollectors.map(BigInt);
    const bid = stage === 'first' || stage === 'outbid';
    const amount = stage === 'first' ? reserve : reserve + increment;
    const payer = stage === 'outbid' ? refundCollectors[1] : refundCollectors[0];
    if (bid) {
        const expectedLeader = stage === 'first' ? 0n : first;
        if (state !== 1n || due !== 0n || total !== 0n || leader !== expectedLeader ||
            price !== (stage === 'first' ? 0n : reserve) || locked !== (stage === 'first' ? 0n : deposit)) {
            return { unavailable: 'This bid requires its reviewed predecessor and an open auction. Refresh after finality.' };
        }
        const [[minimum], [required]] = await Promise.all([read('minimum', 2, 1), read('deposit', amount, 1)]);
        if (minimum !== amount || required !== deposit) throw Error('The minimum bid or its required deposit changed.');
        return { operation: 'placeBid', payer, data: calls.placeBid + word(2) + word(minimum),
            value: '0x' + required.toString(16), bidWei: String(minimum), biddingEnd: String(end) };
    }
    if (total !== 1n || cursor !== 0n || leader !== second || price !== reserve + increment) {
        return { unavailable: 'The reviewed pair of bids and its outstanding refund must be present.' };
    }
    if (stage === 'close') {
        if (state !== 1n || due !== 1n) return { unavailable: 'Closing is available after bidding ends, while the auction is still open.' };
        return { operation: 'closeAuction', payer, data: calls.closeAuction + word(2), value: '0x0' };
    }
    if (![2n, 4n, 5n, 6n].includes(state)) return { unavailable: 'The Core opens refunds once the auction has closed on-chain.' };
    return { operation: 'processRefunds', payer, data: calls.processRefunds + word(2) + word(1), value: '0x0' };
}
