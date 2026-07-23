// A-42: the Prometheus /metrics endpoint requires an explicit, non-empty
// credential resolved at startup, the server binds to loopback only, and a
// missing credential fails closed before any listener or indexing work.
//
// Before this change src/indexer/production-runner.js fell back to a
// public-code `admin:changeme` credential when METRICS_AUTH was unset, and the
// HTTP server bound to all interfaces (server.listen(port) with no host).
//
// These tests exercise the real exported helpers over an ephemeral loopback
// port, so they run identically on Windows and Ubuntu. Importing the modules
// must not trigger the CLI entrypoint.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');

function moduleUrl(relativePath) {
    return pathToFileURL(path.join(ROOT, relativePath)).href;
}

const authModule = import(moduleUrl('src/indexer/metrics-auth.js'));

// A distinctive secret so credential-leak assertions are unambiguous.
const SECRET = 'Basic dGVzdC1vcGVyYXRvcjpzdXBlci1zZWNyZXQtdmFsdWU=';
const METRIC_BODY = '# HELP indexer_up 1\nindexer_up 1\n';
const METRIC_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

function stubIndexer() {
    return {
        async getHealth() {
            return { status: 'healthy', indexer: { unresolvedErrors: 0 } };
        },
        metrics: {
            async getMetrics() { return METRIC_BODY; },
            getContentType() { return METRIC_CONTENT_TYPE; }
        }
    };
}

// Start the real server on an ephemeral loopback port and return its base URL.
async function startServer(overrides = {}) {
    const { createIndexerHttpServer, listenAsync } = await authModule;
    const server = createIndexerHttpServer(stubIndexer(), { metricsAuth: SECRET, ...overrides });
    await listenAsync(server, 0, '127.0.0.1');
    const address = server.address();
    return { server, address, baseUrl: `http://127.0.0.1:${address.port}` };
}

// Close a server whether or not it ever bound, resolving regardless of state
// so a test's cleanup can never hang or throw.
function closeServer(server) {
    return new Promise((resolve) => {
        if (!server || !server.listening) {
            resolve();
            return;
        }
        server.close(() => resolve());
    });
}

test('resolveMetricsAuth returns the configured header when present', async () => {
    const { resolveMetricsAuth } = await authModule;
    assert.equal(resolveMetricsAuth({ METRICS_AUTH: SECRET }), SECRET);
});

test('resolveMetricsAuth fails closed for missing, empty and whitespace-only values', async () => {
    const { resolveMetricsAuth } = await authModule;
    for (const env of [{}, { METRICS_AUTH: '' }, { METRICS_AUTH: '   ' }, { METRICS_AUTH: '\t\n' }, { METRICS_AUTH: undefined }]) {
        assert.throws(() => resolveMetricsAuth(env), /METRICS_AUTH is required/);
    }
});

test('resolveMetricsAuth error never contains the credential value', async () => {
    const { resolveMetricsAuth } = await authModule;
    // Even a stray non-string is rejected without echoing anything sensitive.
    try {
        resolveMetricsAuth({ METRICS_AUTH: '   ' });
        assert.fail('should have thrown');
    } catch (error) {
        assert.doesNotMatch(error.message, /Basic /);
        assert.doesNotMatch(error.message, /changeme/);
    }
});

test('createIndexerHttpServer refuses to build without a resolved credential', async () => {
    const { createIndexerHttpServer } = await authModule;
    for (const bad of [undefined, '', '   ']) {
        assert.throws(
            () => createIndexerHttpServer(stubIndexer(), { metricsAuth: bad }),
            /requires a resolved, non-empty metricsAuth/
        );
    }
});

test('listenAsync rejects a bind failure (EADDRINUSE) so the indexer will not start', async () => {
    const { createIndexerHttpServer, listenAsync } = await authModule;
    // Two independent servers competing for one loopback port. Two active
    // listeners on the same 127.0.0.1:port fail with EADDRINUSE on both Linux
    // and Windows (SO_REUSEADDR permits rebinding a TIME_WAIT socket, not a
    // second live listener), so this is deterministic and cross-platform.
    const first = createIndexerHttpServer(stubIndexer(), { metricsAuth: SECRET });
    const second = createIndexerHttpServer(stubIndexer(), { metricsAuth: SECRET });
    try {
        await listenAsync(first, 0, '127.0.0.1');
        const takenPort = first.address().port;

        await assert.rejects(
            listenAsync(second, takenPort, '127.0.0.1'),
            (error) => {
                assert.equal(error.code, 'EADDRINUSE');
                return true;
            }
        );

        // The rejected server never became a listener.
        assert.equal(second.listening, false);
    } finally {
        await closeServer(second);
        await closeServer(first);
    }
});

test('the listener binds to 127.0.0.1, never a public interface', async () => {
    const { server, address } = await startServer();
    try {
        assert.equal(address.address, '127.0.0.1');
        assert.notEqual(address.address, '0.0.0.0');
        assert.notEqual(address.address, '::');
    } finally {
        server.close();
    }
});

test('/health is reachable without an Authorization header', async () => {
    const { server, baseUrl } = await startServer();
    try {
        const response = await fetch(`${baseUrl}/health`);
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.status, 'healthy');
    } finally {
        server.close();
    }
});

test('/metrics without Authorization returns 401 and a challenge', async () => {
    const { server, baseUrl } = await startServer();
    try {
        const response = await fetch(`${baseUrl}/metrics`);
        assert.equal(response.status, 401);
        assert.equal(response.headers.get('www-authenticate'), 'Basic realm="Metrics"');
        const body = await response.text();
        assert.equal(body, 'Unauthorized');
        assert.doesNotMatch(body, /Basic /);
    } finally {
        server.close();
    }
});

test('/metrics with a wrong Authorization returns 401', async () => {
    const { server, baseUrl } = await startServer();
    try {
        const response = await fetch(`${baseUrl}/metrics`, {
            headers: { Authorization: 'Basic d3Jvbmc6d3Jvbmc=' }
        });
        assert.equal(response.status, 401);
    } finally {
        server.close();
    }
});

test('/metrics with the exact configured Authorization returns 200 with metrics', async () => {
    const { server, baseUrl } = await startServer();
    try {
        const response = await fetch(`${baseUrl}/metrics`, {
            headers: { Authorization: SECRET }
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), METRIC_CONTENT_TYPE);
        assert.equal(await response.text(), METRIC_BODY);
    } finally {
        server.close();
    }
});

test('credentialsMatch is exact and normalizes a missing header to empty', async () => {
    const { credentialsMatch } = await authModule;
    assert.equal(credentialsMatch(SECRET, SECRET), true);
    assert.equal(credentialsMatch('', SECRET), false);
    assert.equal(credentialsMatch(undefined, SECRET), false);
    assert.equal(credentialsMatch(`${SECRET} `, SECRET), false);
    assert.equal(credentialsMatch(SECRET.toLowerCase(), SECRET), false);
});

test('no request path or error output reveals the credential', async () => {
    const { server, baseUrl } = await startServer();
    const logged = [];
    const originalError = console.error;
    const originalLog = console.log;
    console.error = (...args) => logged.push(args.join(' '));
    console.log = (...args) => logged.push(args.join(' '));
    try {
        await fetch(`${baseUrl}/metrics`); // 401
        await fetch(`${baseUrl}/metrics`, { headers: { Authorization: SECRET } }); // 200
        await fetch(`${baseUrl}/health`);
        await fetch(`${baseUrl}/nope`); // 404
    } finally {
        console.error = originalError;
        console.log = originalLog;
        server.close();
    }
    assert.equal(logged.some(line => line.includes(SECRET)), false);
    assert.equal(logged.some(line => line.includes('changeme')), false);
});

test('the public-code fallback literal and per-request env read are gone', () => {
    const runner = fs.readFileSync(path.join(ROOT, 'src/indexer/production-runner.js'), 'utf8');
    const auth = fs.readFileSync(path.join(ROOT, 'src/indexer/metrics-auth.js'), 'utf8');

    for (const source of [runner, auth]) {
        assert.doesNotMatch(source, /changeme/);
        assert.doesNotMatch(source, /admin:changeme/);
    }
    // The handler no longer reads process.env.METRICS_AUTH per request.
    assert.doesNotMatch(runner, /process\.env\.METRICS_AUTH/);
    // The server binds loopback explicitly and awaits listen before start.
    assert.match(runner, /listenAsync\(server, healthPort, '127\.0\.0\.1'\)/);
    assert.match(runner, /await listenAsync[\s\S]*?await indexer\.start\(\)/);
    assert.doesNotMatch(runner, /http:\/\/localhost:/);
});

test('METRICS_AUTH is validated during config resolution, before construction/listen/start', () => {
    // Structural ordering guard: resolveMetricsAuth is invoked inside
    // resolveProductionIndexerConfig (which runs before `new ProductionIndexer`,
    // the HTTP server, and indexer.start() in main()).
    const runner = fs.readFileSync(path.join(ROOT, 'src/indexer/production-runner.js'), 'utf8');

    const configFnStart = runner.indexOf('function resolveProductionIndexerConfig');
    const configFnEnd = runner.indexOf('\nclass ProductionIndexer');
    const configBody = runner.slice(configFnStart, configFnEnd);
    assert.match(configBody, /metricsAuth: resolveMetricsAuth\(process\.env\)/);

    const resolveCall = runner.indexOf('const config = resolveProductionIndexerConfig()');
    const construct = runner.indexOf('new ProductionIndexer(config)');
    const createServer = runner.indexOf('createIndexerHttpServer(indexer');
    const listen = runner.indexOf("listenAsync(server, healthPort, '127.0.0.1')");
    const start = runner.indexOf('await indexer.start()');
    assert.ok(resolveCall > -1 && construct > resolveCall, 'config resolves before construction');
    assert.ok(createServer > construct, 'server is created after construction');
    assert.ok(listen > createServer && start > listen, 'listen precedes indexer start');
});

test('importing the module does not trigger the CLI entrypoint', async () => {
    // If importing ran main(), it would attempt a real DB connection and throw
    // during resolveProductionIndexerConfig; a clean import proves the guard.
    const mod = await import(moduleUrl('src/indexer/production-runner.js'));
    assert.equal(typeof mod.default, 'function');
});
