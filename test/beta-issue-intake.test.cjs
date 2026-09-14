// B-04 / B-01: a defect report and a change request must not arrive on the
// same form.
//
// Canon B3: do not mix protocol redesign into UI/UX defect fixes. A defect fix
// and a redesign need different evidence, carry different risk, and belong to
// different phases; merged together, the redesign rides in on the defect's
// urgency and nobody reviews it as a redesign. The separation has to exist at
// intake, because that is the only place it costs nothing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const templateDir = path.join(root, '.github', 'ISSUE_TEMPLATE');
const read = (name) => fs.readFileSync(path.join(templateDir, name), 'utf8');

const bug = read('controlled-beta-bug.yml');
const change = read('controlled-beta-change-request.yml');
const config = read('config.yml');
const runbook = fs.readFileSync(path.join(root, 'docs', 'runbooks', 'B4_BETA_DEFECT_TRIAGE.md'), 'utf8');

test('a report has somewhere to go that is not the defect form', () => {
  assert.match(change, /^name: Controlled beta change request$/m);
  assert.match(change, /This form is for "it should be different", not "it is broken"/);
  // And the defect form is not the fallback for everything, because blank
  // issues are off.
  assert.match(config, /blank_issues_enabled: false/);
});

test('the change request says up front what will not change', () => {
  // Canon 3 freezes economics. Letting somebody write a careful proposal about
  // the deposit split without telling them it is frozen wastes their goodwill,
  // which during a beta is the scarcest thing there is.
  assert.match(change, /frozen protocol architecture/);
  for (const term of ['Fees', 'bid increments', 'deposit sizes', 'settlement window']) {
    assert.ok(change.includes(term), `the frozen list must name ${term}`);
  }
  // Recorded rather than refused.
  assert.match(change, /it is recorded and considered for a later phase/);
});

test('neither form invites a secret', () => {
  for (const [name, form] of [['bug', bug], ['change request', change]]) {
    assert.match(form, /seed phrase/i, `${name} must warn about seed phrases`);
    assert.match(form, /private key/i, `${name} must warn about private keys`);
  }
  // And the one class of report that must never be public has a private route.
  assert.match(config, /Security, privacy, or credential exposure/);
  assert.match(config, /security\/advisories\/new/);
});

test('the defect form still requires what a defect needs', () => {
  // This form predates the row and is good. The test exists so a later edit
  // cannot quietly drop a required field and leave triage guessing.
  for (const field of ['steps', 'expected', 'actual', 'environment', 'frequency', 'timestamp', 'recovery']) {
    const block = bug.slice(bug.indexOf(`id: ${field}`));
    assert.notEqual(bug.indexOf(`id: ${field}`), -1, `the defect form must ask for ${field}`);
    assert.match(block.slice(0, 900), /required: true/, `${field} must be required`);
  }
});

test('the triage runbook keeps the canon rule as its first gate', () => {
  assert.match(runbook, /Do not mix protocol redesign into UI\/UX defect fixes/);
  assert.match(runbook, /Gate 1 — is it a defect\?/);
  // The order is the point: whether it is a defect is decided before priority.
  assert.ok(
    runbook.indexOf('Gate 1 — is it a defect?') < runbook.indexOf('Gate 3 — priority'),
    'the defect question comes before the priority question'
  );
});

test('the runbook does not ask for a public record of a private person', () => {
  // Canon B1 asks for issues rather than chat-only notes. It does not ask for
  // a public page naming who is testing, on what device, with which wallet.
  assert.match(runbook, /Track the journeys, not the people/);
  const templates = fs.readdirSync(templateDir).filter((name) => name.endsWith('.yml') && name !== 'config.yml');
  for (const name of templates) {
    const form = read(name);
    assert.doesNotMatch(form, /label: (Your name|Full name|Email|Telegram|Discord handle)/i, `${name} must not collect identity`);
  }
});

test('the two runbooks hand off to each other rather than overlapping', () => {
  // B-03 is "the system is broken". B-04 is "a tester reports something". A
  // report filed during an incident is a symptom of that incident.
  assert.match(runbook, /B3_INCIDENT_RESPONSE\.md/);
  const incident = fs.readFileSync(path.join(root, 'docs', 'runbooks', 'B3_INCIDENT_RESPONSE.md'), 'utf8');
  assert.match(
    incident,
    /Never advance the indexer cursor/,
    'the incident runbook keeps its own first rule'
  );
});
