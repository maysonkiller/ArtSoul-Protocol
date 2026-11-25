import assert from 'node:assert/strict';
import { recordBannerSchedule } from '../../scripts/record-banner-schedule.mjs';

export async function checkBannerRevisions(pool) {
    const at = offset => new Date(Date.now() + offset * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const terms = {
        id: 'one', kind: 'free-partner', slot: 1, sponsorGroup: 'studio', proposedBy: 'team', approvedBy: 'review',
        termsUrl: 'https://example.org/terms', reason: 'Guest exhibition', publishedAt: at(-1), startsAt: at(12), endsAt: at(24)
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
        winningBidWei: auction.reserveWei, recordUrl: 'https://example.org/awards/auction' };
    const awarded = { placements: [accepted, second, auction], awards: [award] };
    await assert.rejects(record(3, { ...awarded, awards: [{ ...award, winningBidWei: '9007199254740992' }] }), /below/);
    assert.deepEqual(await record(3, awarded), { revision: 4, inserted: true });
    assert.deepEqual(await record(3, awarded), { revision: 4, inserted: false });
    await assert.rejects(record(4, { ...awarded, awards: [] }), /changed or removed/);
    const receipt = (await pool.query(`SELECT placements, awards FROM ${table} WHERE revision = 4`)).rows[0];
    assert.deepEqual(receipt, { placements: [], awards: [award] });
    for (const query of [`UPDATE ${table} SET awards = '[]'`, `DELETE FROM ${table}`, `TRUNCATE ${table}`]) {
        await assert.rejects(pool.query(query), /append-only/);
    }
    for (const role of ['anon', 'authenticated', 'service_role']) {
        const { rows } = await pool.query('SELECT has_table_privilege($1, $2, $3) AS allowed',
            [role, table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE']);
        assert.equal(rows[0].allowed, false);
    }
}
