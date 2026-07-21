import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const pages = [
    'index.html',
    'gallery.html',
    'artwork.html',
    'profile.html',
    'upload.html',
    'admin.html',
    'docs-protocol.html',
    'wallet-test.html',
    'visual-lab.html',
    'generate-favicon.html'
];
const forbiddenBrowserCompilers = [
    '@babel/standalone',
    'text/babel',
    'react.development.js',
    'react.production.min.js',
    'react-dom.development.js',
    'react-dom.production.min.js'
];

await Promise.all(pages.map(page => access(path.join(dist, page))));
await access(path.join(dist, 'src/config/upload-policy.js')).catch(() => {
    throw new Error('Missing legacy runtime dependency in dist: src/config/upload-policy.js');
});

for (const page of pages) {
    const [source, built] = await Promise.all([
        readFile(path.join(root, page), 'utf8'),
        readFile(path.join(dist, page), 'utf8')
    ]);

    for (const forbidden of forbiddenBrowserCompilers) {
        if (source.includes(forbidden) || built.includes(forbidden)) {
            throw new Error(`${page} still contains browser compiler/runtime tag: ${forbidden}`);
        }
    }

    if (!built.includes('/assets/')) {
        throw new Error(`${page} does not reference a hashed build asset`);
    }

    const localReferences = [...built.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
        .map(([, reference]) => reference.split('?')[0].split('#')[0])
        .filter(reference => reference && !/^(?:[a-z]+:|\/\/|#)/i.test(reference));

    for (const reference of localReferences) {
        const relativePath = reference.replace(/^\//, '');
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
const javascriptAssets = assetFiles.filter(file => file.endsWith('.js'));
for (const file of javascriptAssets) {
    const bundle = await readFile(path.join(dist, 'assets', file), 'utf8');
    for (const forbidden of ['@babel/standalone', 'src/api/', 'src/indexer/', 'process.env.SUPABASE_SERVICE_ROLE_KEY']) {
        if (bundle.includes(forbidden)) {
            throw new Error(`Forbidden browser bundle content in ${file}: ${forbidden}`);
        }
    }
}

const expectedEntries = ['index', 'gallery', 'artwork', 'profile', 'upload', 'admin', 'docs-protocol', 'visual-lab', 'generate-favicon'];
for (const entry of expectedEntries) {
    if (!javascriptAssets.some(file => file.startsWith(`${entry}-`))) {
        throw new Error(`Hashed ${entry} entry was not emitted`);
    }
}

console.log(`Verified ${pages.length} built HTML routes with no in-browser Babel.`);
