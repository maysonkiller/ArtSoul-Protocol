import { visibleDonationMessage } from '../features/artwork/donation-message.js';

export const DONATION_ABI = [
    'event Donation(address indexed donor, address indexed creator, uint256 indexed artworkId, uint256 amount, string message, bool isAnonymous)'
];

export function parseDonationEvent(args) {
    const data = Object.fromEntries(['donor', 'creator', 'artworkId', 'amount', 'message', 'anonymous']
        .map((key, index) => [key, args[key === 'anonymous' ? 'isAnonymous' : key] ?? args[index]]));
    // PostgreSQL text/jsonb cannot contain U+0000. Preserve exact contract bytes
    // before any queue or event persistence, separately from display-safe text.
    data.message_utf8_hex = Buffer.from(data.message, 'utf8').toString('hex');
    data.message = visibleDonationMessage(data.message);
    return data;
}

export async function projectDonation(client, event, chainId, contractAddress, timestamp) {
    const data = event.eventData;
    if (Number(chainId) !== 84532 || !contractAddress ||
        event.contractAddress?.toLowerCase() !== contractAddress.toLowerCase()) {
        throw new Error('Donation event is outside the configured deployment.');
    }
    const address = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value) && !/^0x0{40}$/i.test(value);
    const uint = value => /^(0|[1-9]\d*)$/.test(String(value)) && BigInt(value) < 2n ** 256n;
    if (!address(data?.donor) || !address(data?.creator) || !uint(data?.artworkId) ||
        BigInt(data.artworkId) === 0n || !uint(data?.amount) || BigInt(data.amount) === 0n ||
        !(typeof data.message === 'string' || (data.message === null &&
            typeof data.message_utf8_hex === 'string' && /^(?:[0-9a-f]{2}){0,560}$/.test(data.message_utf8_hex))) ||
        typeof data.anonymous !== 'boolean') {
        throw new Error('Donation event has invalid fields.');
    }
    // Keep the event even when a direct contract caller exceeds the UI limit.
    // Raw messages remain in contract_events; only display-safe text is projected.
    await client.query(
        `INSERT INTO artwork_donations
         (chain_id, contract_address, transaction_hash, log_index, block_number,
          artwork_id, creator, donor, amount, anonymous, message, recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (chain_id, transaction_hash, log_index) DO NOTHING`,
        [String(chainId), contractAddress.toLowerCase(), event.transactionHash.toLowerCase(),
            event.logIndex, event.blockNumber, String(data.artworkId), data.creator.toLowerCase(),
            data.donor.toLowerCase(), String(data.amount), data.anonymous,
            visibleDonationMessage(data.message), timestamp]
    );
}
