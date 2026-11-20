import { withOrdinaryIssuer } from './ordinary-settlement-intake.js';

const table = 'artsoul_private.ordinary_runner_up_observations';
const identity = 'chain_id=$1 AND core_address=$2 AND auction_id=$3';

// A single latest observation per auction. A block-stamped open observation can
// outlive its deadline in this table; only the contract authorizes a purchase.
export async function ingestOrdinaryRunnerUpOffer(pool, listener, options) {
    const offer = await listener.readOrdinaryRunnerUpOffer(options);
    const changed = await withOrdinaryIssuer(pool, listener, options, offer, async client => {
        const key = [offer.chainId, offer.coreAddress, offer.auctionId];
        const values = [...key, offer.artworkId, offer.blockNumber, offer.blockHash, offer.status, offer.bidder, offer.priceWei, offer.deadline];
        const inserted = await client.query(`INSERT INTO ${table}
            (chain_id,core_address,auction_id,artwork_id,block_number,block_hash,status,bidder,price_wei,deadline)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (chain_id,core_address,auction_id) DO NOTHING`, values);
        if (inserted.rowCount) return true;
        const { rows: [last] } = await client.query(`SELECT * FROM ${table} WHERE ${identity} FOR UPDATE`, key);
        const height = BigInt(last.block_number);
        if (height > BigInt(offer.blockNumber)) throw new Error('Stale runner-up observation');
        const sameTerms = last.bidder === offer.bidder && last.price_wei === offer.priceWei && last.deadline === offer.deadline;
        if (height === BigInt(offer.blockNumber)) {
            if (last.block_hash !== offer.blockHash || last.artwork_id !== offer.artworkId || last.status !== offer.status || !sameTerms) {
                throw new Error('Conflicting runner-up observation');
            }
            return false;
        }
        // Once offered, the contract fixes the buyer, price and deadline. Expiry
        // can still be recorded on-chain, while a purchase or closure is final.
        const validState = last.status === offer.status || last.status === 'not_offered' ||
            last.status === 'open' && offer.status !== 'not_offered' || last.status === 'expired' && offer.status === 'closed';
        if (last.artwork_id !== offer.artworkId || !validState || (last.status !== 'not_offered' && !sameTerms)) {
            throw new Error('Inconsistent runner-up transition');
        }
        await client.query(`UPDATE ${table}
            SET block_number=$4,block_hash=$5,status=$6,bidder=$7,price_wei=$8,deadline=$9 WHERE ${identity}`,
            [...key, offer.blockNumber, offer.blockHash, offer.status, offer.bidder, offer.priceWei, offer.deadline]);
        return true;
    });
    return { changed, offer };
}
