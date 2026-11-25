import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Only the wallet frame schema requests the Zod 3 wire conventions. All other
// modules keep their own package resolution and validation semantics.
const schemaPath = /[/\\]@reown[/\\]appkit-wallet[/\\]dist[/\\]esm[/\\]src[/\\]W3mFrameSchema\.js$/;
const upstreamSha256 = '11e8d0910a5079c954bc94241a6f2a87e6198d7f21d44f05dd235fc8733e8b1c';
const adapter = fileURLToPath(new URL('./reown-frame-zod.mjs', import.meta.url)).replaceAll('\\', '/');

export function reownFrameCompatibility() {
    const walletEntry = createRequire(import.meta.url).resolve('@reown/appkit-wallet');
    return {
        name: 'artsoul-reown-frame-schema',
        resolveId: {
            order: 'pre',
            filter: { id: /^zod$/ },
            async handler(id, importer) {
                if (!importer) return;
                if (schemaPath.test(importer)) {
                    const source = readFileSync(importer, 'utf8').replaceAll('\r\n', '\n');
                    if (createHash('sha256').update(source).digest('hex') !== upstreamSha256) {
                        throw new Error('Recheck wallet frame compatibility after the Reown update.');
                    }
                    return adapter;
                }
                if (importer.replaceAll('\\', '/') === adapter) {
                    // Resolve the real Zod from Reown's dependency, including in npm's nested layout.
                    return this.resolve(id, walletEntry, { skipSelf: true });
                }
            }
        }
    };
}
