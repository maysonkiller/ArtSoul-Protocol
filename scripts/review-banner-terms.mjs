import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import pg from 'pg';
import { getAddress, id, isHexString, TypedDataEncoder, verifyTypedData, ZeroAddress } from 'ethers';
import { readBannerReviewSource } from './read-banner-terms.mjs';
import { readReviewedFile } from './security/read-reviewed-file.mjs';
import { withEvidenceTransaction } from '../src/indexer/finalized-evidence.js';
import { canonicalJson } from '../src/snapshot/snapshot-a.js';

const ledger = 'artsoul_private.banner_terms_reviews';
const roles = ['proposer', 'reviewer'];
const types = { BannerReview: [
    { name: 'action', type: 'string' }, { name: 'placement', type: 'string' }, { name: 'revision', type: 'uint32' },
    { name: 'proposerGroup', type: 'string' }, { name: 'reviewerGroup', type: 'string' },
    { name: 'sponsorGroup', type: 'string' }, { name: 'privateDirectory', type: 'bytes32' },
    { name: 'disclosure', type: 'string' }, { name: 'privateCashTerms', type: 'string' }
] };
const validName = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
function requireCheck(ok, message) { if (!ok) throw new Error(message); }

export function prepareBannerReview(source, directory) {
    requireCheck(isHexString(directory?.ledgerId, 32) && !/^0x0+$/.test(directory.ledgerId) &&
        Array.isArray(directory.members) && directory.members.length >= 2, 'Invalid independent reviewer directory');
    const wallets = new Map();
    for (const row of directory.members) {
        const wallet = getAddress(row.wallet);
        requireCheck(wallet !== ZeroAddress && !wallets.has(wallet) && roles.includes(row.role) && validName(row.person) &&
            Array.isArray(row.groups) && row.groups.length > 0 && row.groups.every(validName), 'Invalid reviewer directory member');
        wallets.set(wallet, row);
    }
    const { preview, proposerGroup, reviewerGroup, sponsorGroup } = source;
    const stage = preview.award ? 'award' : 'terms';
    const domain = { name: 'ArtSoul promotional terms rehearsal', version: '1', chainId: 84532, salt: directory.ledgerId };
    const directoryHash = id(canonicalJson(directory));
    const requests = roles.map(role => ({
        action: role + ' confirmation of ' + stage, placement: preview.terms.id, revision: preview.revision,
        proposerGroup, reviewerGroup, sponsorGroup, privateDirectory: directoryHash,
        disclosure: canonicalJson({ terms: preview.terms, award: preview.award }), privateCashTerms: canonicalJson(source.cashTerms ?? null)
    }));
    return { stage, wallets, domain, types, directoryHash, requests };
}

export function checkBannerSignatures(source, directory, signatures) {
    const { stage, wallets, domain, directoryHash, requests } = prepareBannerReview(source, directory);
    const signers = roles.map((role, i) => {
        requireCheck(isHexString(signatures?.[role], 65), 'Missing complete wallet confirmation');
        const wallet = verifyTypedData(domain, types, requests[i], signatures[role]);
        const member = wallets.get(wallet);
        requireCheck(member?.role === role && member.groups.includes(source[role + 'Group']), 'Confirmation does not match an authorized group and role');
        return { wallet: wallet.toLowerCase(), member };
    });
    const [proposer, reviewer] = signers;
    requireCheck(proposer.member.person !== reviewer.member.person &&
        !proposer.member.groups.some(group => reviewer.member.groups.includes(group)), 'Independent human reviewer required');
    requireCheck(!reviewer.member.groups.includes(source.sponsorGroup) &&
        (stage !== 'award' || !proposer.member.groups.includes(source.sponsorGroup)), 'Sponsor affiliation conflicts with review');
    return { stage, directoryHash, proposer: proposer.wallet, reviewer: reviewer.wallet };
}

// Reconstruct from the immutable schedule rather than accepting disclosure or a deadline from the signers.
export async function recordBannerReview(pool, revision, placementId, directory, signatures) {
    return withEvidenceTransaction(pool, async client => {
        await client.query('SET LOCAL row_security = off');
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('artsoul.banner_schedule_revisions', 0))");
        const source = await readBannerReviewSource(client, revision, placementId);
        const { stage, directoryHash, proposer, reviewer } = checkBannerSignatures(source, directory, signatures);
        const prior = (await client.query('SELECT * FROM ' + ledger + ' WHERE placement_id = $1', [placementId])).rows;
        const existing = prior.find(row => row.stage === stage);
        if (existing) {
            requireCheck(existing.revision === revision && existing.directory_hash === directoryHash &&
                existing.proposer_wallet === proposer && existing.reviewer_wallet === reviewer, 'A different review is already recorded');
            return { stage, revision, inserted: false };
        }
        requireCheck(stage !== 'award' || prior.some(row => row.stage === 'terms' && row.revision < revision),
            'The original auction terms need an earlier authenticated review');
        const terms = source.preview.terms;
        const deadline = stage === 'award' ? terms.startsAt : (terms.opensAt ?? terms.startsAt);
        const cash = source.cashTerms;
        const result = await client.query(`INSERT INTO ${ledger}
            (placement_id, stage, revision, proposer_wallet, reviewer_wallet, proposer_signature, reviewer_signature, directory_hash, reviewed_at,
             payer_wallet, payer_nonce, treasury_wallet, refund_nonce)
            SELECT $1, $2, $3, $4, $5, $6, $7, $8, stamp, $10, $11, $12, $13 FROM (SELECT clock_timestamp() AS stamp) clock
            WHERE stamp < $9::timestamptz OR ($2 = 'award' AND stamp = $9::timestamptz)`,
        [placementId, stage, revision, proposer, reviewer, signatures.proposer.toLowerCase(),
            signatures.reviewer.toLowerCase(), directoryHash, deadline, cash?.sponsorWallet ?? null, cash?.paymentNonce ?? null,
            cash?.protocolTreasury ?? null, cash?.refundSafeNonce ?? null]);
        requireCheck(result.rowCount === 1, 'The independent review missed the deadline');
        return { stage, revision, inserted: true };
    });
}

export async function readReviewedBannerTerms(client, revision, placementId) {
    const { preview } = await readBannerReviewSource(client, revision, placementId);
    const { rows } = await client.query('SELECT reviewed_at FROM ' + ledger +
        ' WHERE placement_id = $1 AND revision = $2 AND stage = $3', [placementId, revision, preview.award ? 'award' : 'terms']);
    requireCheck(rows.length === 1, 'No authenticated review for this revision');
    return { ...preview, status: 'reviewed_terms_rehearsal', reviewedAt: rows[0].reviewed_at.toISOString() };
}

// Read once from the private ledger. HTTP clients can retrieve only this authenticated disclosure.
export async function serveReviewedBannerTerms(client, revision, placementId) {
    const json = JSON.stringify(await readReviewedBannerTerms(client, revision, placementId));
    const path = '/terms/' + revision + '/' + placementId + '.json';
    const etag = '"' + createHash('sha256').update(json).digest('hex') + '"';
    const server = createServer((req, res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, no-cache');
        if (req.headers.host !== '127.0.0.1:' + server.address().port || req.url !== path) {
            return res.writeHead(404).end();
        }
        if (!['GET', 'HEAD'].includes(req.method)) return res.writeHead(405, { Allow: 'GET, HEAD' }).end();
        res.setHeader('ETag', etag);
        if (req.headers['if-none-match'] === etag) return res.writeHead(304).end();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(req.method === 'HEAD' ? undefined : json);
    });
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    return { server, url: 'http://127.0.0.1:' + server.address().port + path };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    let pool;
    try {
        const [action, rawRevision, placementId, signatureFile, ...extra] = process.argv.slice(2);
        const revision = Number(rawRevision);
        requireCheck(['--prepare', '--record', '--read', '--serve'].includes(action) && /^[1-9]\d{0,9}$/.test(rawRevision) && !extra.length &&
            (action === '--record') === Boolean(signatureFile), 'Usage: review-banner-terms.mjs --prepare|--record|--read|--serve REVISION PLACEMENT_ID [confirmations.json]');
        requireCheck(process.env.ARTSOUL_BANNER_DATABASE_URL, 'Set ARTSOUL_BANNER_DATABASE_URL for the rehearsal');
        pool = new pg.Pool({ connectionString: process.env.ARTSOUL_BANNER_DATABASE_URL, max: 1, statement_timeout: 10000, connectionTimeoutMillis: 5000 });
        let result;
        if (action === '--serve') {
            result = { url: (await serveReviewedBannerTerms(pool, revision, placementId)).url };
        } else if (action === '--read') {
            result = await readReviewedBannerTerms(pool, revision, placementId);
        } else {
            requireCheck(process.env.ARTSOUL_BANNER_REVIEW_DIRECTORY, 'Configure the independently retained private reviewer directory');
            const readJson = async path => JSON.parse((await readReviewedFile(path, 64 * 1024)).toString('utf8'));
            const directory = await readJson(process.env.ARTSOUL_BANNER_REVIEW_DIRECTORY);
            if (action === '--record') {
                result = await recordBannerReview(pool, revision, placementId, directory, await readJson(signatureFile));
            } else {
                const prepared = prepareBannerReview(await readBannerReviewSource(pool, revision, placementId), directory);
                result = Object.fromEntries(roles.map((role, i) => [role,
                    TypedDataEncoder.getPayload(prepared.domain, types, prepared.requests[i])]));
            }
        }
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error(error.code || error instanceof SyntaxError ? 'Could not complete the private banner review' : error.message);
        process.exitCode = 1;
    } finally { await pool?.end(); }
}
