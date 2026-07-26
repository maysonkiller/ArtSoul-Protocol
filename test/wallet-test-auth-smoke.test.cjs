const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'wallet-test.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'wallet-test.js'), 'utf8');

test('wallet-test exposes an isolated A1 SIWE and upload-policy variant', () => {
  assert.match(html, /layer=auth/);
  assert.match(html, /E: SIWE \+ upload policy/);
  assert.match(html, /never uploads a file or creates a Storage object/);
  assert.match(html, /id="walletTestCopy"/);
  assert.match(html, /Copy complete log/);
  assert.match(html, /wallet-test\.js\?v=11/);
});

test('the A1 auth variant runs SIWE after the production wallet wrapper connects', () => {
  const layer = source.match(/async function initializeArtSoulLayer\(withAuth\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(layer, 'ArtSoul wallet-test layer must exist');
  assert.match(layer, /await window\.__artsoulAppKitBootPromise/);
  assert.match(layer, /modal = window\.web3Modal \|\| null/);
  assert.match(layer, /await window\.safeConnectWallet\?\.\(\)/);
  assert.match(layer, /await window\.ensureAuthenticated\?\.\(\)/);
  assert.match(layer, /await runA1UploadPolicySmoke\(\)/);
  assert.match(layer, /Tap again to complete SIWE/);
  assert.match(layer, /summarizeA1AuthenticationAttempt/);
  assert.doesNotMatch(layer, /authentication deferred or not completed/);
  assert.doesNotMatch(layer, /address,\s*\n/);
  assert.match(layer, /address: maskAddress\(address\)/);
  assert.match(layer, /debug: withAuth \? null/);
});

test('wallet-test masks WalletConnect session topics in copied diagnostics', () => {
  assert.match(source, /function maskSessionTopic/);
  assert.match(source, /session topic doesn't exist/);
  assert.match(source, /if \(\/topic\/i\.test\(key\)\) return maskSessionTopic\(detail\)/);
  assert.match(source, /safeDetail\(value, entryKey\)/);
});

test('wallet-test copies the complete status and log with an iOS-compatible fallback', () => {
  assert.match(source, /function completeLogText/);
  assert.match(source, /statusElement\.textContent\.trim\(\)/);
  assert.match(source, /logElement\.textContent\.trim\(\)/);
  assert.match(source, /navigator\.clipboard\?\.writeText/);
  assert.match(source, /function copyWithTextarea/);
  assert.match(source, /document\.execCommand\('copy'\)/);
  assert.match(source, /copyButton\.addEventListener\('click', copyCompleteLog\)/);
});

test('wallet-test distinguishes deliberate deferral from SIWE failures', () => {
  assert.match(source, /const A1_AUTH_DIAGNOSTIC_STEPS = new Set/);
  assert.match(source, /SIWE deferred after external mobile wallet connect/);
  assert.match(source, /SIWE signature failed/);
  assert.match(source, /outcome: 'deferred'/);
  assert.match(source, /outcome: 'failed'/);
  assert.match(source, /SIWE did not complete\. Tap Copy complete log/);
});

test('the A1 upload-policy smoke sends only invalid JSON requests and requires exact rejections', () => {
  assert.match(source, /expectedReason: 'UNSUPPORTED_FILE_TYPE'/);
  assert.match(source, /content_type: 'text\/plain'/);
  assert.match(source, /expectedReason: 'INVALID_FILE_SIZE'/);
  assert.match(source, /size: 50 \* 1024 \* 1024 \+ 1/);
  assert.match(source, /fetch\('\/api\/upload\/file'/);
  assert.match(source, /credentials: 'include'/);
  assert.match(source, /response\.status === 400/);
  assert.match(source, /data\?\.error === 'INVALID_UPLOAD_PAYLOAD'/);
  assert.match(source, /!data\?\.signed_upload_url/);
  assert.match(source, /!data\?\.token/);
});

test('the A1 smoke cannot upload a body to Storage or use a signed upload URL', () => {
  const smoke = source.slice(source.indexOf('const A1_UPLOAD_POLICY_CASES'));
  assert.ok(smoke, 'A1 upload-policy smoke must exist');
  assert.doesNotMatch(smoke, /FormData|method:\s*'PUT'|x-upsert|storage\/v1\/object/);
});
