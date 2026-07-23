// A-42: explicit, fail-closed credential and loopback binding for the indexer
// HTTP endpoint. Node built-ins only; no new dependency.
//
// The endpoint exposes an unauthenticated /health (consumed by the local
// monitor) and an authenticated /metrics. Both are bound to loopback by the
// caller, so the credential protects /metrics against local processes rather
// than the public internet. The credential is resolved once at startup and
// passed explicitly to the server, never re-read from process.env per request.
import http from 'node:http';
import crypto from 'node:crypto';

/**
 * Resolve the required Prometheus /metrics credential from the environment.
 *
 * Returns the exact expected Authorization header value (the external contract:
 * METRICS_AUTH is the complete header, e.g. `Basic base64(user:pass)`).
 *
 * Fails closed when the value is missing, empty, or whitespace-only. The error
 * intentionally never includes the value, so a misconfiguration cannot leak a
 * partial secret into logs.
 */
export function resolveMetricsAuth(env = process.env) {
    const raw = env.METRICS_AUTH;
    if (typeof raw !== 'string' || raw.trim() === '') {
        throw new Error(
            'METRICS_AUTH is required and must be a non-empty value: it is the ' +
            'complete Authorization header expected on the /metrics endpoint. ' +
            'Configure it in the indexer environment before startup.'
        );
    }
    return raw;
}

/**
 * Constant-time comparison of a provided header against the expected one.
 *
 * Both strings are SHA-256 digested first, so crypto.timingSafeEqual always
 * receives equal-length (32-byte) buffers and there is no length-based early
 * return that could leak timing. A missing request header must be normalized to
 * an empty string by the caller.
 */
export function credentialsMatch(provided, expected) {
    const providedDigest = crypto.createHash('sha256').update(String(provided), 'utf8').digest();
    const expectedDigest = crypto.createHash('sha256').update(String(expected), 'utf8').digest();
    return crypto.timingSafeEqual(providedDigest, expectedDigest);
}

/**
 * Build the indexer HTTP server. /health is unauthenticated; /metrics requires
 * the exact configured Authorization header. The credential is captured in the
 * closure and never read from process.env on a per-request basis.
 */
export function createIndexerHttpServer(indexer, { metricsAuth } = {}) {
    // Defense in depth: the server must never exist without a resolved
    // credential, mirroring resolveMetricsAuth's fail-closed contract.
    if (typeof metricsAuth !== 'string' || metricsAuth.trim() === '') {
        throw new Error('createIndexerHttpServer requires a resolved, non-empty metricsAuth credential');
    }

    return http.createServer(async (req, res) => {
        try {
            if (req.url === '/health') {
                const health = await indexer.getHealth();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(health));
                return;
            }

            if (req.url === '/metrics') {
                const provided = req.headers.authorization || '';
                if (!credentialsMatch(provided, metricsAuth)) {
                    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Metrics"' });
                    res.end('Unauthorized');
                    return;
                }

                const metrics = await indexer.metrics.getMetrics();
                res.writeHead(200, { 'Content-Type': indexer.metrics.getContentType() });
                res.end(metrics);
                return;
            }

            res.writeHead(404);
            res.end('Not Found');
        } catch (error) {
            // Never surface internal error detail (which could echo request
            // headers) to the client.
            console.error('[ProductionIndexer] HTTP handler error:', error.message);
            if (!res.headersSent) {
                res.writeHead(500);
            }
            res.end('Internal Server Error');
        }
    });
}

/**
 * Promise wrapper around server.listen that resolves only once the listener is
 * active and rejects on a listen error (for example EADDRINUSE). This lets the
 * caller refuse to start indexing when the endpoint cannot bind. Binds to
 * loopback by default so the endpoint is never exposed on a public interface.
 */
export function listenAsync(server, port, host = '127.0.0.1') {
    return new Promise((resolve, reject) => {
        const onError = (error) => {
            server.removeListener('listening', onListening);
            reject(error);
        };
        const onListening = () => {
            server.removeListener('error', onError);
            resolve(server);
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
    });
}
