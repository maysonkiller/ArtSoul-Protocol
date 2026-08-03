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

    const asyncModulePattern = /<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\basync\b)[^>]*>/i;
    if (asyncModulePattern.test(source) || asyncModulePattern.test(built)) {
        throw new Error(`${page} contains an async module entry that can execute before its DOM mount point exists`);
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

// The shared account button must resolve to exactly ONE neutral avatar URL in
// the built output. Vite used to rewrite the static header's
// '/default-avatar.png' to a hashed /assets/default-avatar-<hash>.png while the
// legacy avatar-dropdown.js kept the literal, so the built pages and the
// component disagreed about the same picture: the component saw a different
// src, rewrote the already-rendered image and forced a second request plus a
// blank bitmap frame on every page load. Source-only tests cannot see this
// because the rewrite exists only after a build.
const sharedHeaderPages = [
    'index.html',
    'gallery.html',
    'artwork.html',
    'profile.html',
    'upload.html',
    'admin.html',
    'docs-protocol.html'
];
const builtComponent = await readFile(path.join(dist, 'avatar-dropdown.js'), 'utf8');
const componentNeutralAvatar = builtComponent.match(/const NEUTRAL_AVATAR_URL = '([^']+)';/)?.[1];
if (!componentNeutralAvatar) {
    throw new Error('dist/avatar-dropdown.js does not declare NEUTRAL_AVATAR_URL');
}
await access(path.join(dist, componentNeutralAvatar.replace(/^\//, ''))).catch(() => {
    throw new Error(`The neutral avatar ${componentNeutralAvatar} was not emitted to dist`);
});

for (const page of sharedHeaderPages) {
    const built = await readFile(path.join(dist, page), 'utf8');
    const shellAvatar = built.match(/<img data-avatar-image src="([^"]+)"/)?.[1];
    if (!shellAvatar) {
        throw new Error(`${page} does not ship the static shared-header avatar`);
    }
    if (shellAvatar !== componentNeutralAvatar) {
        throw new Error(
            `${page} static header avatar ${shellAvatar} does not match `
            + `avatar-dropdown.js NEUTRAL_AVATAR_URL ${componentNeutralAvatar}. `
            + 'Two URLs for the same picture cause a duplicate request and a blank frame.'
        );
    }
    if (!built.includes('data-avatar-resolving')) {
        throw new Error(`${page} is missing the coherent resolving label placeholder`);
    }
}

const duplicateNeutralAvatars = assetFiles.filter(file => /^default-avatar-[^.]+\.(png|jpe?g|webp|svg)$/i.test(file));
if (duplicateNeutralAvatars.length > 0) {
    throw new Error(
        `A hashed duplicate of the neutral avatar was emitted: ${duplicateNeutralAvatars.join(', ')}. `
        + 'It must be served from publicDir at exactly one URL.'
    );
}

console.log(
    `Verified ${pages.length} built HTML routes with no in-browser Babel or async module-entry mount races, `
    + `and one shared neutral avatar (${componentNeutralAvatar}) across ${sharedHeaderPages.length} header pages.`
);
