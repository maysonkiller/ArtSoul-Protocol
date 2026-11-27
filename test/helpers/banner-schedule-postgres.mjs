import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { recordBannerSchedule } from '../../scripts/record-banner-schedule.mjs';
import { readBannerReviewSource, readBannerTerms } from '../../scripts/read-banner-terms.mjs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Wallet, hexlify, randomBytes } from 'ethers';
import { readReviewedBannerTerms, recordBannerReview, serveReviewedBannerTerms } from '../../scripts/review-banner-terms.mjs';

async function checkSignedReview(pool, placementId) {
    const revision = 1;
    const members = [Wallet.createRandom(), Wallet.createRandom()];
    const directory = { ledgerId: hexlify(randomBytes(32)), members: [
        { wallet: members[0].address, role: 'proposer', person: 'first', groups: ['team'] },
        { wallet: members[1].address, role: 'reviewer', person: 'second', groups: ['review'] }
    ] };
    const folder = await mkdtemp(join(tmpdir(), 'artsoul-banner-review-'));
    const policy = join(folder, 'directory.json');
    const confirmation = join(folder, 'confirmations.json');
    const env = { ...process.env, ARTSOUL_BANNER_DATABASE_URL: `postgresql://postgres@127.0.0.1:${pool.options.port}/postgres`,
        ARTSOUL_BANNER_REVIEW_DIRECTORY: policy };
    const command = async (...args) => {
        const { stdout } = await promisify(execFile)(process.execPath, ['scripts/review-banner-terms.mjs', ...args],
            { env, timeout: 15000 });
        return JSON.parse(stdout);
    };
    const sign = async (version = '1', placement = placementId, privateDirectory = directory) => {
        await writeFile(policy, JSON.stringify(privateDirectory));
        const payloads = await command('--prepare', version, placement);
        const signatures = {};
        for (const [i, role] of ['proposer', 'reviewer'].entries()) {
            const { domain, types, message } = payloads[role];
            delete types.EIP712Domain;
            signatures[role] = await members[i].signTypedData(domain, types, message);
        }
        return signatures;
    };
    try {
        await assert.rejects(readReviewedBannerTerms(pool, revision, placementId), /No authenticated review/);
        const valid = await sign();
        await assert.rejects(recordBannerReview(pool, revision, placementId, directory,
            { proposer: valid.reviewer, reviewer: valid.proposer }), /authorized group/);
        await assert.rejects(recordBannerReview(pool, 2, placementId, directory, valid), /authorized group/);
        for (const [override, message] of [
            [{ person: 'first' }, /Independent human/],
            [{ groups: ['review', 'team'] }, /Independent human/],
            [{ groups: ['review', 'studio'] }, /affiliation conflicts/]
        ]) {
            const alternate = { ...directory, members: [directory.members[0], { ...directory.members[1], ...override }] };
            await assert.rejects(recordBannerReview(pool, revision, placementId, alternate,
                await sign('1', placementId, alternate)), message);
        }
        const award = await sign('4', 'auction');
        await assert.rejects(recordBannerReview(pool, 4, 'auction', directory, award), /earlier authenticated review/);
        await assert.rejects(recordBannerReview(pool, 3, 'auction', directory, await sign('3', 'auction')), /missed the deadline/);
        await writeFile(confirmation, JSON.stringify(valid));
        const retries = await Promise.all([1, 2].map(() => command('--record', '1', placementId, confirmation)));
        assert.deepEqual(retries.map(r => r.inserted).sort(), [false, true]);
        const disclosure = await command('--read', '1', placementId);
        assert.equal(disclosure.status, 'reviewed_terms_rehearsal');
        assert.ok(Date.parse(disclosure.reviewedAt) >= Date.parse(disclosure.terms.recordedAt));
        assert.equal(disclosure.terms.sponsor.name, 'Studio One');
        assert.doesNotMatch(JSON.stringify(disclosure), /proposer|reviewer|sponsorGroup|0x|directory|signature/i);
        const { server, url } = await serveReviewedBannerTerms(pool, revision, placementId);
        try {
            const response = await fetch(url);
            assert.equal(response.status, 200);
            assert.deepEqual(await response.json(), disclosure);
            assert.equal((await fetch(url, { method: 'HEAD' })).status, 200);
            assert.equal((await fetch(url, { headers: { 'If-None-Match': response.headers.get('etag') } })).status, 304);
            assert.equal((await fetch(url + '/other')).status, 404);
            assert.equal((await fetch(url, { method: 'POST' })).status, 405);
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
        const rows = await pool.query('SELECT proposer_wallet, reviewer_wallet, recorded_by FROM artsoul_private.banner_terms_reviews');
        assert.deepEqual(rows.rows, [{ proposer_wallet: members[0].address.toLowerCase(), reviewer_wallet: members[1].address.toLowerCase(), recorded_by: 'postgres' }]);
        assert.ok((await readBannerReviewSource(pool, 1, placementId)).reviewerGroup === 'review');
        const original = (await pool.query('SELECT placements,awards FROM artsoul_private.banner_schedule_revisions ORDER BY revision')).rows;
        const placements = original.flatMap(row => row.placements);
        const cash = { sponsorWallet:'0x'+'1'.repeat(40), protocolTreasury:'0x'+'2'.repeat(40), paymentNonce:'4', refundSafeNonce:'8', refundWei:'101' };
        const deals = [0, 1, 2].map(i => {
            const start = Date.now() + (i + 3) * 86400000;
            const time = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
            return { ...placements.find(p => p.id === 'direct'), id:'cash-'+i, feeWei:'501', startsAt:time(start), endsAt:time(start+3600000),
                cashTerms: { ...cash,paymentNonce:i === 2 ? '5' : '4',refundSafeNonce:i === 1 ? '9' : '8' } };
        });
        await recordBannerSchedule(pool,6,{ placements:[...placements,...deals], awards:original.flatMap(row=>row.awards) });
        for (const [i, deal] of deals.entries()) {
            const sigs = await sign('7',deal.id);
            const record = recordBannerReview(pool,7,deal.id,directory,sigs);
            if (i === 0) assert((await record).inserted);
            else await assert.rejects(record,{ code:'23505' });
        }
        const paidDisclosure = await readReviewedBannerTerms(pool,7,'cash-0');
        assert.equal(paidDisclosure.terms.refundWei,'101');
        assert.doesNotMatch(JSON.stringify(paidDisclosure),/sponsorWallet|protocolTreasury"|paymentNonce|refundSafeNonce|0x[0-9a-f]{40}/);
        for (const role of ['anon', 'authenticated', 'service_role']) {
            const result = await pool.query("SELECT has_table_privilege($1, 'artsoul_private.banner_terms_reviews','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS allowed", [role]);
            assert.equal(result.rows[0].allowed, false);
        }
        await assert.rejects(pool.query('DELETE FROM artsoul_private.banner_terms_reviews'), /append-only/);
    } finally {
        await rm(folder, { recursive: true, force: true });
    }
}

export async function checkBannerRevisions(pool) {
    const at = offset => new Date(Date.now() + offset * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const terms = {
        id: 'one', kind: 'free-partner', slot: 1, sponsorGroup: 'studio', proposedBy: 'team', approvedBy: 'review',
        termsUrl: 'https://example.org/terms', reason: 'Guest exhibition', publishedAt: at(-1), startsAt: at(12), endsAt: at(24),
        sponsorName: 'Studio One', relationship: 'Exhibition partner'
    };
    const plan = (...placements) => ({ placements, awards: [] });
    const record = (revision, next) => recordBannerSchedule(pool, revision, next);
    const table = 'artsoul_private.banner_schedule_revisions';
    const competing = await Promise.allSettled([record(0, plan(terms)), record(0, plan({ ...terms, id: 'two' }))]);
    assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(competing.filter(result => result.status === 'rejected').length, 1);
    const first = (await pool.query(`SELECT placements, recorded_by FROM ${table}`)).rows[0];
    assert.equal(first.recorded_by, 'postgres');
    const accepted = first.placements[0];
    assert.deepEqual(await record(0, plan(accepted)), { revision: 1, inserted: false });
    await assert.rejects(record(1, plan({ ...accepted, reason: 'Different terms' })), /changed or removed/);
    await assert.rejects(record(1, plan(accepted, { ...terms, id: 'late', startsAt: at(-0.5) })), /Overlapping|deadline/);
    await assert.rejects(record(1, plan(accepted, { ...terms, id: 'same-lane', sponsorGroup: 'other' })), /Overlapping slot/);
    const second = { ...terms, id: 'other', slot: 2, sponsorGroup: 'second' };
    const together = plan(accepted, second);
    await assert.rejects(record(0, together), /Stale/);
    const identical = await Promise.all([record(1, together), record(1, together)]);
    assert.deepEqual(identical.map(row => row.inserted).sort(), [false, true]);
    assert.deepEqual(await record(2, plan(second, accepted)), { revision: 2, inserted: false });
    const revisions = await pool.query(`SELECT revision, jsonb_array_length(placements) AS additions FROM ${table} ORDER BY revision`);
    assert.deepEqual(revisions.rows, [{ revision: 1, additions: 1 }, { revision: 2, additions: 1 }]);
    // A previously recorded auction has closed for bidding, with delivery still ahead.
    // Seed its past recording instant directly instead of waiting for a clock boundary.
    const auction = { id: 'auction', kind: 'auction', slot: 3, publishedAt: at(-6),
        opensAt: at(-5), closesAt: at(-2), startsAt: at(12), endsAt: at(24),
        reserveWei: '9007199254740993', payee: 'ProtocolTreasury', approvedBy: 'review', proposedBy: 'team',
        termsUrl: 'https://example.org/terms/auction' };
    await pool.query(`INSERT INTO ${table} (revision, placements, awards, recorded_at) VALUES (3, $1, '[]', $2)`,
        [JSON.stringify([auction]), auction.publishedAt]);
    const award = { placementId: 'auction', sponsorGroup: 'winning-group', decidedAt: at(-1),
        winningBidWei: auction.reserveWei, recordUrl: 'https://example.org/awards/auction',
        sponsorName: 'Artist Collective', relationship: 'Auction sponsor' };
    const awarded = { placements: [accepted, second, auction], awards: [award] };
    await assert.rejects(record(3, { ...awarded, awards: [{ ...award, winningBidWei: '9007199254740992' }] }), /below/);
    assert.deepEqual(await record(3, awarded), { revision: 4, inserted: true });
    assert.deepEqual(await record(3, awarded), { revision: 4, inserted: false });
    await assert.rejects(record(4, { ...awarded, awards: [] }), /changed or removed/);
    const receipt = (await pool.query(`SELECT placements, awards FROM ${table} WHERE revision = 4`)).rows[0];
    assert.deepEqual(receipt, { placements: [], awards: [award] });
    const free = await readBannerTerms(pool, 1, accepted.id);
    assert.deepEqual(free.terms, { id: accepted.id, kind: 'free-partner', slot: 1, startsAt: terms.startsAt,
        endsAt: terms.endsAt, termsUrl: terms.termsUrl, recordedAt: free.terms.recordedAt,
        sponsor: { name:'Studio One', relationship:'Exhibition partner' }, reason:'Guest exhibition', feeWei:'0', inKind:null });
    assert.ok(Date.parse(free.terms.recordedAt) > Date.parse(terms.publishedAt));
    assert.deepEqual(await readBannerTerms(pool, 4, accepted.id), { ...free, revision: 4 });
    await assert.rejects(readBannerTerms(pool, 1, 'other'), /No recorded terms/);
    await assert.rejects(readBannerTerms(pool, 5, 'auction'), /No recorded terms/);
    const beforeAward = await readBannerTerms(pool, 3, 'auction');
    assert.equal(beforeAward.terms.reserveWei, '9007199254740993');
    assert.equal(beforeAward.award, null);
    const final = await readBannerTerms(pool, 4, 'auction');
    assert.equal(final.status, 'recorded_terms_preview');
    assert.deepEqual(final.award, { sponsor: { name:'Artist Collective', relationship:'Auction sponsor' },
        winningBidWei: award.winningBidWei, decidedAt: award.decidedAt, recordedAt: final.award.recordedAt, recordUrl: award.recordUrl });
    assert.doesNotMatch(JSON.stringify([free, final]), /proposedBy|approvedBy|sponsorGroup|winning-group|recorded_by|postgres/);
    const earlier = { ...terms, id: 'older', startsAt: at(32), endsAt: at(36) };
    delete earlier.sponsorName;
    delete earlier.relationship;
    await record(4, { placements: [...awarded.placements, earlier], awards: [award] });
    await assert.rejects(readBannerTerms(pool, 5, 'older'), /no reviewed public name/);
    const deal = { ...terms, kind:'negotiated', id:'direct', startsAt:at(40), endsAt:at(48),
        feeWei:'9007199254740995', inKind:'Workshop space', payee:'ProtocolTreasury' };
    await record(5, { placements:[...awarded.placements, earlier, deal], awards:[award] });
    const negotiated = await readBannerTerms(pool, 6, 'direct');
    assert.deepEqual([negotiated.terms.feeWei,negotiated.terms.inKind,negotiated.terms.payee],
        [deal.feeWei,'Workshop space','ProtocolTreasury']);
    const command = await promisify(execFile)(process.execPath, ['scripts/read-banner-terms.mjs','6','direct'], {
        env: { ...process.env, ARTSOUL_BANNER_DATABASE_URL: `postgresql://postgres@127.0.0.1:${pool.options.port}/postgres` },
        timeout: 15000
    });
    assert.deepEqual(JSON.parse(command.stdout), negotiated);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const invalid = [{...terms,id:'late',publishedAt:at(-5),startsAt:at(-1)}, {...terms,id:'duplicate'},
            {...terms,id:'duplicate'}, {...terms,id:'oversize',reason:'x'.repeat(17000)}];
        await client.query(`INSERT INTO ${table} (revision,placements,awards) VALUES (7,$1,'[]')`, [JSON.stringify(invalid)]);
        await assert.rejects(readBannerTerms(client,7,'late'), /recording window/);
        await assert.rejects(readBannerTerms(client,7,'duplicate'), /Duplicate id/);
        await assert.rejects(readBannerTerms(client,7,'oversize'), /16 KiB preview limit/);
        const past = {...auction,id:'past-auction',publishedAt:at(-10),opensAt:at(-8),closesAt:at(-4),startsAt:at(-1)};
        const lateAward = {...award,placementId:past.id,decidedAt:past.startsAt};
        await client.query(`INSERT INTO ${table} (revision,placements,awards,recorded_at) VALUES
            (8,$1,'[]',$2), (9,'[]',$3,$4::timestamptz + interval '1 microsecond')`,
        [JSON.stringify([past]),past.publishedAt,JSON.stringify([lateAward]),past.startsAt]);
        await assert.rejects(readBannerTerms(client,9,past.id), /award missed its recording window/);
        await client.query(`CREATE ROLE banner_view_fixture; GRANT USAGE ON SCHEMA artsoul_private TO banner_view_fixture;
            GRANT SELECT ON ${table} TO banner_view_fixture; SET LOCAL ROLE banner_view_fixture`);
        await assert.rejects(readBannerTerms(client,6,'direct'), /cannot see the whole private schedule/);
    } finally {
        await client.query('ROLLBACK');
        client.release();
    }
    for (const query of [`UPDATE ${table} SET awards = '[]'`, `DELETE FROM ${table}`, `TRUNCATE ${table}`]) {
        await assert.rejects(pool.query(query), /append-only/);
    }
    for (const role of ['anon', 'authenticated', 'service_role']) {
        const { rows } = await pool.query('SELECT has_table_privilege($1, $2, $3) AS allowed',
            [role, table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE']);
        assert.equal(rows[0].allowed, false);
    }
    await pool.query(await readFile(new URL('../../sql/migrations/20261127031000_banner_terms_reviews.sql', import.meta.url), 'utf8'));
    await checkSignedReview(pool, accepted.id);
}
