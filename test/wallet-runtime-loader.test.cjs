const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'wallet-runtime-loader.js'), 'utf8');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function executeLoader(loadModuleForTest, readyState = 'complete') {
    const transformed = SOURCE.replace(
        "import('./appkit-init.js?v=54')",
        'loadModuleForTest()'
    );
    assert.notEqual(transformed, SOURCE, 'the harness must replace the one production dynamic import');

    const listeners = new Map();
    const events = [];
    const window = {
        dispatchEvent(event) {
            events.push(event.type);
        }
    };
    const document = {
        readyState,
        addEventListener(name, listener) {
            const registered = listeners.get(name) || [];
            registered.push(listener);
            listeners.set(name, registered);
        }
    };
    const context = {
        window,
        document,
        loadModuleForTest,
        CustomEvent: class CustomEvent {
            constructor(type) {
                this.type = type;
            }
        },
        requestAnimationFrame() {},
        setTimeout,
        console
    };

    vm.runInNewContext(transformed, context, { filename: 'wallet-runtime-loader.js' });
    return {
        window,
        events,
        fire(name) {
            if (name === 'DOMContentLoaded') document.readyState = 'interactive';
            for (const listener of listeners.get(name) || []) listener();
        }
    };
}

test('wallet action waits for AppKit boot, not only for module evaluation', async () => {
    const boot = deferred();
    let moduleLoads = 0;
    let implementationCalls = 0;
    let window;

    const harness = executeLoader(async () => {
        moduleLoads += 1;
        window.__artsoulAppKitBootPromise = boot.promise;
        window.safeConnectWallet = async () => {
            implementationCalls += 1;
            return 'connected';
        };
        return {};
    });
    window = harness.window;

    const connection = window.safeConnectWallet();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(moduleLoads, 1);
    assert.equal(implementationCalls, 0, 'the wallet action must not run against a half-booted runtime');
    assert.equal(window.ArtSoulWalletRuntime.isLoading(), true);
    assert.equal(window.ArtSoulWalletRuntime.isReady(), false);
    assert.deepEqual(harness.events, []);

    boot.resolve();
    assert.equal(await connection, 'connected');
    assert.equal(implementationCalls, 1);
    assert.equal(window.ArtSoulWalletRuntime.isLoading(), false);
    assert.equal(window.ArtSoulWalletRuntime.isReady(), true);
    assert.deepEqual(harness.events, ['artsoul:wallet-runtime-ready']);

    assert.equal(await window.safeConnectWallet(), 'connected');
    assert.equal(moduleLoads, 1, 'the initialized runtime must be reused');
});

test('an action before DOMContentLoaded waits for the boot promise created by AppKit', async () => {
    const boot = deferred();
    let implementationCalls = 0;
    let window;

    const harness = executeLoader(async () => {
        window.safeConnectWallet = async () => {
            implementationCalls += 1;
            return 'connected';
        };
        return {};
    }, 'loading');
    window = harness.window;

    const connection = window.safeConnectWallet();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(implementationCalls, 0);

    window.__artsoulAppKitBootPromise = boot.promise;
    harness.fire('DOMContentLoaded');
    await Promise.resolve();
    assert.equal(implementationCalls, 0, 'DOMContentLoaded alone must not release the action');

    boot.resolve();
    assert.equal(await connection, 'connected');
    assert.equal(implementationCalls, 1);
    assert.equal(window.ArtSoulWalletRuntime.isReady(), true);
});

test('a tab that never gets a frame still boots the wallet runtime', async () => {
  // Found on a Vercel preview: the page had been open four seconds with the
  // proxies installed, ArtSoulWalletRuntime present, and isReady() still false.
  // requestAnimationFrame is the right signal - it fires after the browser has
  // had a frame, which is the point of deferring the SDK - but a frame is
  // exactly what a background tab never produces. A page opened in one and read
  // later would sit with no wallet runtime: a restored session would not
  // reconnect, and anything asking whether a wallet is present would be told no.
  const source = fs.readFileSync(path.join(__dirname, '..', 'wallet-runtime-loader.js'), 'utf8');

  assert.match(source, /WALLET_RUNTIME_START_FALLBACK_MS/, 'a fallback timer must exist');
  assert.match(source, /setTimeout\(start, WALLET_RUNTIME_START_FALLBACK_MS\)/,
    'the fallback must be scheduled unconditionally, not only when rAF is missing');

  // The frame path and the timer path both call start(), so start() has to be
  // idempotent or a visible page imports the runtime twice.
  assert.match(source, /if \(started\) return;/, 'start must run once');

  const fallback = Number((source.match(/WALLET_RUNTIME_START_FALLBACK_MS = (\d+)/) || [])[1]);
  assert.ok(Number.isFinite(fallback), 'the fallback delay must be a literal');
  assert.ok(fallback > 0 && fallback <= 3000,
    'long enough for a visible page to win on its own frame, short enough that a hidden tab is not stranded');
});
