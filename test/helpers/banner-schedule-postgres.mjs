import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { recordBannerSchedule } from '../../scripts/record-banner-schedule.mjs';
import { readBannerTerms } from '../../scripts/read-banner-terms.mjs';

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
}
