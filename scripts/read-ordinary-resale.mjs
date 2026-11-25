import { pathToFileURL } from 'node:url';
import { ingestOrdinaryReceipt, runReceiptCommand } from './read-ordinary-receipt.mjs';

export function ingestOrdinaryResale(pool, pair, location, providers) {
    return ingestOrdinaryReceipt('resale', pool, pair, location, providers);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await runReceiptCommand('resale', process.argv.slice(2));
}
