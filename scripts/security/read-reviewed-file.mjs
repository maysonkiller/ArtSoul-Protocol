import { open } from 'node:fs/promises';

export async function readReviewedFile(file, limit) {
    const handle = await open(file, 'r');
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size < 1 || stat.size > limit) throw new Error('Reviewed file has an invalid size');
        const bytes = Buffer.alloc(stat.size);
        let used = 0;
        while (used < bytes.length) {
            const { bytesRead } = await handle.read(bytes, used, bytes.length - used, used);
            if (!bytesRead) throw new Error('Reviewed file changed during verification');
            used += bytesRead;
        }
        if ((await handle.stat()).size !== stat.size) throw new Error('Reviewed file changed during verification');
        return bytes;
    } finally { await handle.close(); }
}
