import { allowMethods, sendError, supabaseRest } from '../../backend.js';
import { readDonationConfig } from '../../donation-config.js';
import { visibleDonationMessage } from '../../../features/artwork/donation-message.js';

export function publicDonation(row, names = new Map(), hidden = false) {
    const anonymous = row.anonymous === true;
    return {
        transaction_hash: row.transaction_hash,
        log_index: row.log_index,
        block_number: row.block_number,
        creator: row.creator,
        donor: anonymous ? null : row.donor,
        donor_name: anonymous ? null : names.get(row.donor) || null,
        anonymous,
        amount: String(row.amount),
        message: visibleDonationMessage(row.message, hidden),
        recorded_at: row.recorded_at
    };
}

export default async function donationsHandler(req, res) {
    if (!allowMethods(req, res, ['GET'])) return;
    try {
        const config = readDonationConfig();
        if (!config.enabled) return res.status(503).json({ error: 'DONATIONS_UNAVAILABLE' });
        const artworkId = String(req.query?.artwork_id || '');
        const chainId = Number(req.query?.chain_id);
        const offset = Number(req.query?.offset || 0);
        const sort = req.query?.sort || 'newest';
        if (chainId !== config.chainId || !/^[1-9]\d{0,77}$/.test(artworkId) ||
            BigInt(artworkId) >= 2n ** 256n || !Number.isSafeInteger(offset) || offset < 0 ||
            offset > 10000 || !['newest', 'amount'].includes(sort)) {
            return res.status(400).json({ error: 'INVALID_DONATION_LOOKUP' });
        }
        const scope = `chain_id=eq.${chainId}&artwork_id=eq.${artworkId}`;
        const [artworks, visibility] = await Promise.all([
            supabaseRest(`v41_artworks?select=creator&${scope}&limit=1`),
            supabaseRest(`artwork_moderation_visibility?select=hidden&${scope}&limit=1`)
        ]);
        if (!artworks?.length || visibility?.[0]?.hidden === true) {
            return res.status(404).json({ error: 'ARTWORK_UNAVAILABLE' });
        }
        const fields = 'transaction_hash,log_index,block_number,creator,donor,amount,anonymous,message,recorded_at';
        const base = `artwork_donations?select=${fields}&${scope}&contract_address=eq.${config.address}`;
        const order = 'block_number.desc,log_index.desc';
        const [rows, topRows] = await Promise.all([
            supabaseRest(`${base}&order=${sort === 'amount' ? 'amount.desc,' : ''}${order}&limit=21&offset=${offset}`),
            supabaseRest(`${base}&order=amount.desc,${order}&limit=1`)
        ]);
        const page = rows.slice(0, 20);
        const records = [...page, ...topRows];
        const donors = [...new Set(records.filter(row => row.anonymous !== true).map(row => row.donor))];
        const transactions = [...new Set(records.map(row => row.transaction_hash))];
        const [profiles, hiddenMessages] = await Promise.all([
            donors.length ? supabaseRest(`profiles?select=wallet_address,username&wallet_address=in.(${donors.join(',')})`) : [],
            transactions.length ? supabaseRest(`donation_message_visibility?select=transaction_hash,log_index,hidden&chain_id=eq.${chainId}&transaction_hash=in.(${transactions.join(',')})&hidden=eq.true`) : []
        ]);
        const names = new Map(profiles.map(row => [row.wallet_address, row.username]));
        const hidden = new Set(hiddenMessages.map(row => `${row.transaction_hash}:${row.log_index}`));
        const project = row => publicDonation(row, names, hidden.has(`${row.transaction_hash}:${row.log_index}`));
        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=15');
        return res.status(200).json({
            success: true, chain_id: chainId, artwork_id: artworkId,
            contract_address: config.address, creator: artworks[0].creator,
            donations: page.map(project), top: topRows[0] ? project(topRows[0]) : null,
            next_offset: rows.length > 20 && offset + 20 <= 10000 ? offset + 20 : null
        });
    } catch (error) { return sendError(res, error); }
}
