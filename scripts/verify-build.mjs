import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const legacyPages = [
    'index.html',
    'gallery.html',
    'artwork.html',
    'profile.html',
    'upload.html',
    'auction-system.html',
    'visual-lab.html',
    'generate-favicon.html'
];

const requiredPages = ['docs.html', ...legacyPages];
await Promise.all(requiredPages.map(page => access(path.join(dist, page))));
const preExistingMissingReferences = [];

const builtDocs = await readFile(path.join(dist, 'docs.html'), 'utf8');
for (const forbidden of ['@babel/standalone', 'text/babel', 'react.development.js', 'react-dom.development.js']) {
    if (builtDocs.includes(forbidden)) {
        throw new Error(`docs.html still contains browser compiler/runtime tag: ${forbidden}`);
    }
}

for (const page of legacyPages) {
    const [source, built] = await Promise.all([
        readFile(path.join(root, page)),
        readFile(path.join(dist, page))
    ]);
    if (!source.equals(built)) {
        throw new Error(`Unmigrated page changed during build: ${page}`);
    }

    const html = source.toString('utf8');
    const localReferences = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
        .map(([, reference]) => reference.split('?')[0].split('#')[0])
        .filter(reference => reference && !/^(?:[a-z]+:|\/\/|#)/i.test(reference));

    for (const reference of localReferences) {
        const relativePath = reference.replace(/^\//, '');
        try {
            await access(path.join(root, relativePath));
        } catch {
            preExistingMissingReferences.push(`${page}: ${reference}`);
            continue;
        }
        await access(path.join(dist, relativePath)).catch(() => {
            throw new Error(`Missing ${page} dependency in dist: ${reference}`);
        });
    }
}

for (const forbiddenDirectory of ['api', 'contracts', 'docs', 'sql', 'supabase', 'test']) {
    try {
        await access(path.join(dist, forbiddenDirectory));
        throw new Error(`Server/non-browser directory leaked into dist: ${forbiddenDirectory}`);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
}

const assetFiles = await readdir(path.join(dist, 'assets'));
const docsEntry = assetFiles.find(file => /^docs-[\w-]+\.js$/.test(file));
if (!docsEntry) {
    throw new Error('Hashed docs entry was not emitted');
}

const docsBundle = await readFile(path.join(dist, 'assets', docsEntry), 'utf8');
for (const forbidden of ['@reown/appkit', '@supabase/supabase-js', '/api/public/']) {
    if (docsBundle.includes(forbidden)) {
        throw new Error(`Unrelated legacy dependency entered the docs React bundle: ${forbidden}`);
    }
}

console.log(`Verified ${requiredPages.length} HTML routes; only docs.html is migrated.`);
if (preExistingMissingReferences.length) {
    console.warn(`Preserved ${preExistingMissingReferences.length} pre-existing missing page references:`);
    for (const reference of preExistingMissingReferences) console.warn(`- ${reference}`);
}
