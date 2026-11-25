// Isolated PostgreSQL with synthetic notices only; no hosted database or credentials.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const CONTAINER = `artsoul-profile-notices-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const A = `0x${'1'.repeat(40)}`, B = `0x${'2'.repeat(40)}`;
const read = name => fs.readFileSync(path.join(ROOT, 'sql/migrations', name), 'utf8');
const migration = read('20261116115041_profile_notification_read_state.sql');
const historical = [
    ['20261029212603_notification_reorg_identity.sql', 'read_notification_summary', 'text,text,boolean,boolean,boolean'],
    ['notification_summary.sql', 'mark_personal_moderation_notifications', 'text,bigint[],boolean'],
    ['notification_inbox_removal.sql', 'remove_personal_moderation_notifications', 'text,bigint[]']
];
const oldDefinitions = historical.map(([file, name]) => {
    const source = read(file).replace(/\r\n/g, '\n');
    const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    assert.ok(start >= 0, `load maintained ${name} definition`);
    return source.slice(start, source.indexOf('\n$$;', start) + 4);
});
function docker(args, input) {
    return execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 }).trim();
}
let available = false;
try { available = docker(['version', '--format', '{{.Server.Os}}']) === 'linux'; } catch {}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('profile notices support existing private inbox operations (PostgreSQL 17)', {
    skip: available ? false : 'Disposable PostgreSQL requires Docker', timeout: 120000
}, async t => {
    let created = false;
    t.after(() => { if (created) docker(['rm', '-f', '-v', CONTAINER]); });
    docker(['run', '-d', '--rm', '--name', CONTAINER, '--network', 'none',
        '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=artsoul', 'postgres:17']);
    created = true;
    const sql = statement => docker(['exec', '-i', CONTAINER, 'psql', '-X', '-qAt',
        '-U', 'postgres', '-d', 'artsoul', '-v', 'ON_ERROR_STOP=1'], statement);
    for (let attempt = 0; ; attempt++) {
        try { assert.equal(sql('SELECT 1'), '1'); await delay(250); assert.equal(sql('SELECT 1'), '1'); break; }
        catch (error) { if (attempt >= 60) throw error; await delay(500); }
    }
    const inspected = JSON.parse(docker(['inspect', CONTAINER]))[0];
    assert.equal(inspected.HostConfig.NetworkMode, 'none');
    assert.equal(Object.keys(inspected.HostConfig.PortBindings || {}).length, 0);
    const json = statement => JSON.parse(sql(statement));
    const service = statement => json(`SET ROLE service_role; ${statement}`);
    const summary = (wallet = A) => service(`SELECT public.read_notification_summary('${wallet}',NULL,false,false,false);`);
    const idsSql = ids => `ARRAY[${ids.join(',')}]::bigint[]`;
    const mark = (ids, value = true, wallet = A) => service(`SELECT public.mark_personal_moderation_notifications('${wallet}',${idsSql(ids)},${value});`);
    const remove = (ids, wallet = A) => service(`SELECT public.remove_personal_moderation_notifications('${wallet}',${idsSql(ids)});`);
    const rows = () => json('SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY id),\'[]\') FROM public.artwork_report_notifications n;');
    sql(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
        GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
        CREATE TABLE public.auction_notification_preferences(wallet_address text,core_address text,revision bigint,
          auction_created boolean,outbid boolean,lifecycle boolean,reminders boolean,reminder_minutes integer[]);
        CREATE TABLE public.artwork_report_notifications(id bigint PRIMARY KEY,recipient_wallet text NOT NULL,
          notification_type text NOT NULL,read_at timestamptz,dismissed_at timestamptz);
        ALTER TABLE public.artwork_report_notifications ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.artwork_report_notifications FORCE ROW LEVEL SECURITY;
        ${oldDefinitions.join('\n')}
        ${historical.map(([, name, signature]) => `REVOKE ALL ON FUNCTION public.${name}(${signature}) FROM PUBLIC,anon,authenticated;
          GRANT EXECUTE ON FUNCTION public.${name}(${signature}) TO service_role;`).join('\n')}`);
    // The unknown fixture probes fail-closed behavior if a later schema adds a new type.
    const reset = () => sql(`TRUNCATE public.artwork_report_notifications;
        INSERT INTO public.artwork_report_notifications VALUES
          (1,'${A}','PROFILE_CONTENT_HIDDEN',NULL,NULL),(2,'${A}','PROFILE_CONTENT_RESTORED',NULL,NULL),
          (3,'${B}','PROFILE_CONTENT_HIDDEN',NULL,NULL),(4,'${A}','UNKNOWN_FUTURE_NOTICE',NULL,NULL),
          (5,'${A}','REPORT_ACTIONED',NULL,NULL),(6,'${A}','PROFILE_CONTENT_HIDDEN',NULL,'2026-01-01'),
          (7,'${A}','PROFILE_CONTENT_RESTORED','2026-01-01',NULL);`);
    reset();
    assert.equal(summary().moderationCount, 1, 'reproduce the old missing profile count');
    assert.deepEqual(mark(['1', '2']), { updated: false }, 'reproduce the owner read rejection');
    assert.deepEqual(remove(['1', '2']), { removed: false }, 'reproduce the owner remove rejection');
    const catalog = () => json(`SELECT jsonb_agg(jsonb_build_object('oid',oid,'name',proname,'owner',proowner,'acl',proacl::text,
        'securityDefiner',prosecdef,'config',proconfig,'volatility',provolatile,'parallel',proparallel,'strict',proisstrict,
        'body',prosrc) ORDER BY proname) FROM pg_proc WHERE pronamespace='public'::regnamespace;`);
    const beforeCatalog = catalog(), beforeRows = rows();
    sql(migration); sql(migration);

    await t.test('replay changes only the two type literals and preserves function identities, permissions and data', () => {
        const after = catalog();
        assert.deepEqual(after.map(fn => ({ ...fn, body: fn.body.replace(/,\n\s*'PROFILE_CONTENT_HIDDEN','PROFILE_CONTENT_RESTORED'/g, '') })), beforeCatalog);
        assert.deepEqual(rows(), beforeRows);
        for (const role of ['anon', 'authenticated']) {
            for (const query of [
                `read_notification_summary('${A}',NULL,false,false,false)`,
                `mark_personal_moderation_notifications('${A}',ARRAY[1::bigint],true)`,
                `remove_personal_moderation_notifications('${A}',ARRAY[1::bigint])`
            ]) assert.throws(() => sql(`SET ROLE ${role}; SELECT public.${query};`), /permission denied for function/);
        }
        assert.equal(summary().moderationCount, 3);
        assert.equal(summary(B).moderationCount, 1);
        assert.equal(summary().auctionCount, 0);
        assert.equal(summary().reminderCount, 0);
    });

    await t.test('both profile types support read, unread and removal with stable replay and no resurrection', () => {
        reset();
        for (const id of ['1', '2']) {
            assert.deepEqual(mark([id]), { updated: true, ids: [id], read: true });
            const readAt = rows().find(row => String(row.id) === id).read_at;
            assert.ok(readAt);
            mark([id]);
            assert.equal(rows().find(row => String(row.id) === id).read_at, readAt);
        }
        assert.equal(summary().moderationCount, 1);
        assert.deepEqual(mark(['1', '2'], false), { updated: true, ids: ['1', '2'], read: false });
        assert.equal(summary().moderationCount, 3);
        assert.deepEqual(remove(['1', '2']), { removed: true, ids: ['1', '2'] });
        const dismissed = rows(); remove(['1', '2']);
        assert.deepEqual(rows(), dismissed, 'removal replay retains its original timestamp');
        mark(['1', '2'], false);
        assert.equal(summary().moderationCount, 1, 'dismissed notices do not reappear as unread');
        assert.deepEqual(rows().filter(row => ![1, 2].includes(row.id)), beforeRows.filter(row => ![1, 2].includes(row.id)));
    });

    await t.test('mixed foreign, missing and unknown notices reject atomically', () => {
        reset();
        for (const invalid of ['3', '4', '999']) {
            const before = rows();
            assert.deepEqual(mark(['1', invalid]), { updated: false });
            assert.deepEqual(remove(['2', invalid]), { removed: false });
            assert.deepEqual(rows(), before);
        }
        assert.deepEqual(mark(['1'], true, B), { updated: false });
        assert.deepEqual(remove(['2'], B), { removed: false });
        assert.deepEqual(mark(['4']), { updated: false });
        assert.deepEqual(remove(['4']), { removed: false });
        assert.equal(summary().moderationCount, 3);
    });

    await t.test('existing notice types, exact bigint IDs and existing count and mutation bounds remain intact', () => {
        reset();
        const types = ['REPORT_ACTIONED','REPORT_DISMISSED','REPORT_RESOLVED','REPORT_REOPENED',
            'ARTWORK_HIDDEN','ARTWORK_RESTORED','DONATION_MESSAGE_HIDDEN','DONATION_MESSAGE_RESTORED'];
        sql(`TRUNCATE public.artwork_report_notifications;
            INSERT INTO public.artwork_report_notifications(id,recipient_wallet,notification_type) VALUES
              ${types.map((type, i) => `(${i + 1},'${A}','${type}')`).join(',')},
              (9007199254740993,'${A}','PROFILE_CONTENT_HIDDEN'),(9223372036854775807,'${A}','PROFILE_CONTENT_RESTORED');`);
        const ids = types.map((_, i) => String(i + 1)).concat('9007199254740993', '9223372036854775807');
        assert.equal(summary().moderationCount, 10);
        assert.deepEqual(mark(ids), { updated: true, ids, read: true });
        assert.equal(summary().moderationCount, 0);
        mark(ids, false); assert.equal(summary().moderationCount, 10);
        assert.deepEqual(remove(ids), { removed: true, ids });
        assert.equal(summary().moderationCount, 0);
        sql(`INSERT INTO public.artwork_report_notifications(id,recipient_wallet,notification_type)
            SELECT id,'${A}',CASE WHEN id%2=0 THEN 'PROFILE_CONTENT_HIDDEN' ELSE 'PROFILE_CONTENT_RESTORED' END FROM generate_series(100,209) id;`);
        assert.equal(summary().moderationCount, 100);
        const twenty = Array.from({ length: 20 }, (_, i) => String(100 + i));
        assert.deepEqual(mark(twenty), { updated: true, ids: twenty, read: true });
        assert.equal(summary().moderationCount, 90);
        for (const bad of [[], ['100', '100'], ['-1'], ['NULL'], Array.from({ length: 21 }, (_, i) => String(100 + i))]) {
            const before = rows();
            assert.throws(() => mark(bad), /Invalid personal notification update/);
            assert.throws(() => remove(bad), /Invalid personal notification removal/);
            assert.deepEqual(rows(), before);
        }
    });

    await t.test('unread summary proves eligible auction rows and skips read or dismissed rows', () => {
        const guard = read('20261125175447_notification_summary_skip_read_proofs.sql');
        const core = `0x${'4'.repeat(40)}`;
        const permissions = () => catalog().map(({ body, ...identity }) => identity);
        const before = permissions();
        sql(guard);
        sql(guard);
        assert.deepEqual(permissions(), before);
        sql(`CREATE TABLE public.indexer_state(chain_id bigint,contract_address text);
            CREATE TABLE public.artwork_media_chain_revisions(chain_id bigint,revision bigint);
            CREATE TABLE public.outbox_events(id bigint PRIMARY KEY,event_type text,payload jsonb);
            CREATE TABLE public.auction_notification_reads(wallet_address text,core_address text,outbox_id bigint,read boolean,dismissed_at timestamptz);
            INSERT INTO public.indexer_state VALUES(84532,'${core}');
            INSERT INTO public.artwork_media_chain_revisions VALUES(84532,1);
            INSERT INTO public.outbox_events SELECT id,'notification',jsonb_build_object('type','auction_created','recipient','${A}')
              FROM generate_series(1,4) id;
            INSERT INTO public.auction_notification_reads VALUES
              ('${A}','${core}',1,true,NULL),('${A}','${core}',2,false,now()),('${B}','${core}',3,true,NULL);
            CREATE TABLE public.fixture_proof_calls(id bigint);
            CREATE FUNCTION public.canonical_auction_notifications_v2(text,text,bigint,bigint[],boolean,boolean,boolean)
              RETURNS TABLE(id bigint) LANGUAGE plpgsql AS $body$
              BEGIN
                INSERT INTO public.fixture_proof_calls SELECT unnest($4);
                -- The fourth synthetic event has no canonical receipt.
                RETURN QUERY SELECT value FROM unnest($4) value WHERE value<>4;
              END $body$;`);
        const result = service(`SELECT public.read_notification_summary('${A}','${core}',true,true,false);`);
        assert.equal(result.auctionCount, 1);
        assert.deepEqual(json('SELECT jsonb_agg(id ORDER BY id) FROM public.fixture_proof_calls;'), [3, 4]);
    });
});
