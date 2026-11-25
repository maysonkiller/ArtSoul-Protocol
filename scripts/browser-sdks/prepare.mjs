import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// The small SDK installation is needed only by the browser build and dev
// server. Direct imports inside its two entries resolve against this lock.
const directory = new URL('./', import.meta.url);
const read = path => readFile(new URL(path, directory), 'utf8');
const lock = await read('package-lock.json');
const rootLock = JSON.parse(await read('../../package-lock.json'));
const packagePath = 'node_modules/@reown/appkit';
const rootVersion = rootLock.packages[packagePath].version;
const packages = JSON.parse(lock).packages;
if (packages['../../' + packagePath].version !== rootVersion ||
    JSON.parse(await read('../../' + packagePath + '/package.json')).version !== rootVersion) {
    throw new Error('Recheck the browser SDK lock against the installed site AppKit before building.');
}
const stamp = createHash('sha256').update(lock.replaceAll('\r\n', '\n')).update(rootVersion).digest('hex');
const stampPath = new URL('node_modules/.artsoul-sdk-lock', directory);
let ready = false;
try {
    const rootAppKit = await realpath(new URL('../../' + packagePath, directory));
    const linkedAppKit = await realpath(new URL(packagePath, directory));
    ready = rootAppKit === linkedAppKit && (await readFile(stampPath, 'utf8')) === stamp;
    for (const name of ['@walletconnect/ethereum-provider', '@supabase/supabase-js']) {
        const installed = JSON.parse(await read('node_modules/' + name + '/package.json'));
        ready = ready && installed.version === packages['node_modules/' + name].version;
    }
} catch (error) {
    if (error.code !== 'ENOENT') throw error;
}
if (!ready) {
    if (!process.env.npm_execpath) throw new Error('Run npm run prepare:browser-sdks using the project npm version.');
    const install = spawnSync(process.execPath, [process.env.npm_execpath, 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline'], {
        cwd: fileURLToPath(directory), stdio:'inherit', windowsHide:true
    });
    if (install.error) throw install.error;
    if (install.status !== 0) throw new Error('The locked browser SDK installation failed.');
    if (await realpath(new URL(packagePath, directory)) !== await realpath(new URL('../../' + packagePath, directory))) {
        throw new Error('The mobile browser SDK must share the site AppKit.');
    }
    await writeFile(stampPath, stamp);
}
