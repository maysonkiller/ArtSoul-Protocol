const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

const entry = read('docs/testnet/CONTROLLED_BETA_ENTRY.md');
const guide = read('docs/testnet/TESTER_GUIDE.md');
const fallbackReport = read('docs/testnet/BUG_REPORT_TEMPLATE.md');
const handoff = read('docs/HANDOFF.md');
const backlog = read('docs/BACKLOG.md');
const canonicalBacklog = read('docs/canon/12_IMPLEMENTATION_BACKLOG.md');
const issueFormSource = read('.github/ISSUE_TEMPLATE/controlled-beta-bug.yml');
const issueForm = yaml.load(issueFormSource);

test('controlled-beta entry pack is explicitly NO-GO until evidence and P1 gates pass', () => {
    assert.match(entry, /Status: \*\*NO-GO/);
    assert.match(entry, /GO is permitted only when every operator checklist item is evidenced and no P1/);
    assert.match(entry, /Any missing evidence means NO-GO/);
    assert.match(entry, /Supported desktop and external-mobile wallet acceptance/);
    assert.match(entry, /real wallet-signed publish-to-index projection smoke/);
    assert.match(entry, /Every open issue was reviewed and there is no open P1/);
});

test('entry pack contains every A10 deliverable and links the operating surfaces', () => {
    for (const heading of [
        '## 2. Entry checklist for testers',
        '## 3. Support and issue intake',
        '## 5. Known prototype deviations',
        '## 6. Operator pre-window checklist',
        '## 7. Pause conditions',
        '## 8. Go / no-go decision record'
    ]) {
        assert.match(entry, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }

    assert.match(entry, /\[tester guide\]\(TESTER_GUIDE\.md\)/);
    assert.match(entry, /issues\/new\?template=controlled-beta-bug\.yml/);
    assert.match(handoff, /testnet\/CONTROLLED_BETA_ENTRY\.md/);
    assert.match(handoff, /template=controlled-beta-bug\.yml/);
});

test('prototype deviations preserve frozen economics and single-chain testnet scope', () => {
    assert.match(entry, /Only Base Sepolia \(`84532`\) is an active product testnet/);
    assert.match(entry, /90% seller \/ 7\.5% creator \/ 2\.5% protocol/);
    assert.match(entry, /Frozen 92\.5% \/ 5\.5% \/ 1% \/ 1% split/);
    assert.match(entry, /Frozen primary and resale economics are not changed/);
    assert.match(entry, /it is not Genesis and is never migrated/);
    assert.match(entry, /Ethereum Sepolia data can remain readable/);
    assert.doesNotMatch(entry, /\btoken allocation\b|\bairdrop\b|\bpoints program\b/i);
});

test('tester-facing documents use Base Sepolia only and remove stale hard-coded auction instructions', () => {
    assert.match(guide, /Active test network:\n\n- Base Sepolia/);
    assert.doesNotMatch(guide, /Supported test networks:[\s\S]*Ethereum Sepolia/);
    assert.doesNotMatch(guide, /Do not settle Base Sepolia `auctionId=2`/);
    assert.match(guide, /Use only the artwork and auction IDs assigned by the operator/);
    assert.match(fallbackReport, /P1 — safety, authorization, economic truth/);
    assert.doesNotMatch(fallbackReport, /- Ethereum Sepolia/);
});

test('public issue form parses and requires reproducible, redacted evidence', () => {
    assert.equal(issueForm.name, 'Controlled beta bug');
    assert.equal(issueForm.title, '[Controlled beta]: ');
    assert.ok(Array.isArray(issueForm.body));

    const byId = new Map(issueForm.body.filter(item => item.id).map(item => [item.id, item]));
    for (const id of [
        'safety',
        'priority',
        'role',
        'surface',
        'page',
        'environment',
        'steps',
        'expected',
        'actual',
        'frequency',
        'timestamp',
        'evidence',
        'recovery',
        'final_check'
    ]) {
        assert.ok(byId.has(id), `missing issue form field: ${id}`);
    }

    for (const id of [
        'safety',
        'priority',
        'role',
        'surface',
        'page',
        'environment',
        'steps',
        'expected',
        'actual',
        'frequency',
        'timestamp',
        'recovery',
        'final_check'
    ]) {
        const item = byId.get(id);
        const isRequired = item.validations?.required === true
            || item.attributes?.options?.some(option => option.required === true);
        assert.equal(isRequired, true, `${id} must be required`);
    }

    assert.match(issueFormSource, /Never post a seed phrase, private key, session topic/);
    assert.match(issueFormSource, /Report security, privacy, copyright, or credential exposure privately/);
});

test('both backlogs show preparation in progress without falsely accepting A10', () => {
    const durableRow = backlog.split('\n').find(line => line.includes('| A-23 |'));
    assert.ok(durableRow);
    assert.match(durableRow, /\| in progress \|/);
    assert.match(durableRow, /remains NO-GO/);

    const canonicalRow = canonicalBacklog.split('\n').find(line => line.includes('**A10 — Controlled beta entry.'));
    assert.ok(canonicalRow);
    assert.match(canonicalRow, /^- \[ \]/);
    assert.match(canonicalRow, /acceptance remains open/);
});
