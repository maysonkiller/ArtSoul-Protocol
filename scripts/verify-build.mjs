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
    'collection-builder.html',
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

async function verifyLocalReference(page, reference) {
    const relativePath = reference.replace(/^\//, '');
    const candidates = relativePath
        ? [relativePath, `${relativePath}.html`]
        : ['index.html'];

    for (const candidate of candidates) {
        try {
            await access(path.join(dist, candidate));
            return;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }

    throw new Error(`Missing ${page} dependency in dist: ${reference}`);
}

await Promise.all(pages.map(page => access(path.join(dist, page))));
const manifest = JSON.parse(await readFile(path.join(dist, '.vite/manifest.json'), 'utf8'));
const sdkKeys = ['scripts/browser-sdks/wallet.mjs', 'scripts/browser-sdks/supabase.mjs'];
for (const key of sdkKeys) {
    const chunk = manifest[key];
    if (!chunk?.isDynamicEntry || !/^assets\/[\w-]+\.js$/.test(chunk.file)) {
        throw new Error(`Missing deferred same-origin browser SDK: ${key}`);
    }
    await verifyLocalReference(key, chunk.file);
}
if (manifest['supabase-client.js']?.file !== 'supabase-client.js') {
    throw new Error('Legacy pages require the stable Supabase client URL.');
}
const staticEntries = new Set();
function visitStaticEntry(key) {
    if (staticEntries.has(key)) return;
    staticEntries.add(key);
    for (const dependency of manifest[key]?.imports || []) visitStaticEntry(dependency);
}
for (const key of [...pages, 'supabase-client.js']) visitStaticEntry(key);
if (sdkKeys.some(key => staticEntries.has(key))) {
    throw new Error('A browser SDK was moved onto the initial page load path.');
}
const browserLicenses = await readFile(path.join(dist, 'third-party-licenses.txt'), 'utf8');
const browserNotice = await readFile(path.join(dist, 'third-party-notices.txt'), 'utf8');
if (!browserLicenses.includes('## @walletconnect/ethereum-provider -') ||
    !browserLicenses.includes('## @supabase/supabase-js -') ||
    !browserLicenses.includes('WALLETCONNECT COMMUNITY LICENSE AGREEMENT') ||
    !browserNotice.includes('Portions © 2025 Reown, Inc. All Rights Reserved')) {
    throw new Error('The browser SDK distributions require their bundled third-party notices.');
}
// These legacy modules are copied verbatim. An external import here would
// sidestep the dependency lock even when the bundled wallet passes its audit.
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const ethersVersion = lock.packages['node_modules/ethers'].version;
const ethersAsset = `/assets/ethers-${ethersVersion}.min.js`;
const installedEthers = await readFile(path.join(root, 'node_modules/ethers/dist/ethers.min.js'));
if (!(await readFile(path.join(dist, ethersAsset))).equals(installedEthers)) {
    throw new Error('The browser ethers asset differs from the locked package.');
}
for (const consumer of ['contracts-integration.js', 'src/features/auction/auction-service.js', 'src/core/rpc/rpc-client.js']) {
    const module = await readFile(path.join(dist, consumer), 'utf8');
    if (!module.includes(`import { ethers } from '${ethersAsset}';`) || /from\s+['"]https?:/.test(module)) {
        throw new Error(`${consumer}: expected the locked, same-origin ethers module`);
    }
}
await verifyLocalReference('Audio previews', '/brand/artsoul-audio-cover-384.webp');
for (const filename of ['robots.txt', 'sitemap.xml', '.well-known/security.txt']) {
    if (!(await readFile(path.join(dist, filename))).equals(await readFile(path.join(root, 'public', filename)))) {
        throw new Error(`Public discovery file differs from its source: ${filename}`);
    }
}
await access(path.join(dist, 'src/config/upload-policy.js')).catch(() => {
    throw new Error('Missing legacy runtime dependency in dist: src/config/upload-policy.js');
});

// Cached metadata may still request the original filename on a static host.
// Both URLs must contain the one approved image, even without Vercel redirects.
const approvedSocialImage = await readFile(path.join(root, 'artsoul-social-preview-v2.png'));
if (approvedSocialImage.length < 24 || !approvedSocialImage.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || approvedSocialImage.readUInt32BE(16) !== 1730 || approvedSocialImage.readUInt32BE(20) !== 909) {
    throw new Error('Approved social preview must remain a 1730 x 909 PNG');
}
for (const filename of ['artsoul-social-preview-v2.png', 'artsoul-social-preview.png', 'artsoul-social-preview-v3.png']) {
    if (!(await readFile(path.join(dist, filename))).equals(approvedSocialImage)) {
        throw new Error(`Obsolete social preview in dist: ${filename}`);
    }
}

for (const page of pages) {
    const [source, built] = await Promise.all([
        readFile(path.join(root, page), 'utf8'),
        readFile(path.join(dist, page), 'utf8')
    ]);

    // Verify the actual built response, not merely the source HTML. Exact
    // metadata equivalence also protects artwork-specific tag IDs and URLs.
    const socialTags = html => (html.slice(0, html.indexOf('</head>')).match(/^[ \t]*<meta\b[^>\r\n]*\b(?:property|name)=["'](?:og:|twitter:)[^>\r\n]*>[ \t]*\r?$/gmi) || []).map(tag => tag.trim());
    const expectedSocial = socialTags(source).map(tag => tag.replace('https://artsoulprotocol.com/artsoul-social-preview-v2.png', 'https://artsoulprotocol.com/artsoul-social-preview-v3.png'));
    const actualSocial = socialTags(built);
    if (JSON.stringify(actualSocial) !== JSON.stringify(expectedSocial)) {
        throw new Error(page + ': social metadata was lost, duplicated or unexpectedly changed');
    }
    if (expectedSocial.length) {
        const charsetIndex = built.search(/<meta\s+charset=["']utf-8["'][^>]*>/i);
        if (charsetIndex < 0 || Buffer.byteLength(built.slice(0, charsetIndex)) >= 1024) {
            throw new Error(page + ': UTF-8 declaration is missing or too late');
        }
        for (const tag of actualSocial) {
            const index = built.indexOf(tag);
            if (index < 0 || Buffer.byteLength(built.slice(0, index + tag.length)) > 4096) {
                throw new Error(page + ': social metadata must appear in the first 4 KiB of HTML');
            }
        }
        if (actualSocial.filter(tag => /\bproperty=["']og:image["']/.test(tag)).length !== 1
            || actualSocial.filter(tag => /\bname=["']twitter:image["']/.test(tag)).length !== 1
            || !actualSocial.some(tag => /\bname=["']twitter:card["']/.test(tag) && /content=["']summary_large_image["']/.test(tag))) {
            throw new Error(page + ': incomplete or ambiguous social preview metadata');
        }
    }

    if (page === 'collection-builder.html' && !/<div id="app">\s*<main\b[^>]*aria-busy="true"/.test(built)) {
        throw new Error('The collection editor must show its initial page while the application loads.');
    }

    if (page === 'gallery.html' && !/<h1>Art worth discovering<\/h1>[\s\S]*?<div id="app">/.test(built)) {
        throw new Error('The gallery heading must be visible before the filter and artwork bundle starts.');
    }

    if (page === 'index.html') {
        if (/<(?:script|link)\b[^>]*\b(?:src|href)=["']\/(?:contracts-integration\.js|assets\/ethers-[^"']+\.js|src\/index\.js|src\/ui\/components\/index\.js)(?:\?[^"']*)?["']/i.test(built)) {
            throw new Error('The guest homepage must not preload wallet or gallery services');
        }
        const balancedHero = /<h1\b[^>]*>\s*Discover a work and start its next chapter\s*<\/h1>/;
        if (!balancedHero.test(source) || !balancedHero.test(built)) {
            throw new Error('The homepage headline must be one naturally wrapping phrase without a forced break.');
        }
    }

    // Do not replace already painted fallback text when a font arrives late.
    for (const html of [source, built]) {
        for (const [, url] of html.matchAll(/href="(https:\/\/fonts\.googleapis\.com\/[^"]+)"/g)) {
            if (new URL(url).searchParams.get('display') !== 'optional') {
                throw new Error(`${page} allows a late webfont swap after first paint`);
            }
        }
    }

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

    if (['gallery.html', 'profile.html', 'artwork.html'].includes(page)) {
        const name = page.slice(0, -5);
        const entry = built.match(new RegExp(`<script type="module"[^>]*src="/assets/${name}-[^"<>]+\\.js"[^>]*><\\/script>`))?.[0];
        const entryPosition = entry ? built.indexOf(entry) : -1;
        const contractPosition = built.indexOf('src="/contracts-integration.js');
        const servicePosition = built.indexOf('src="/src/index.js');
        const cardPosition = built.indexOf('src="/src/ui/components/artwork-card.js');
        if (page === 'gallery.html') {
            const galleryRuntime = built.indexOf('src="/src/features/discovery/gallery-contract-runtime.js');
            if (entryPosition < 0 || galleryRuntime < entryPosition || contractPosition >= 0 || servicePosition >= 0) {
                throw new Error('The gallery must mount before its wallet loader and keep contract services off the guest path');
            }
        } else if (entryPosition < 0 || contractPosition < entryPosition || servicePosition < entryPosition) {
            throw new Error(`${page}: public entry must precede legacy contract/service modules`);
        }
        if (cardPosition < 0 || cardPosition > entryPosition) {
            throw new Error(`${page}: classic artwork cards must initialize before the public entry`);
        }
    }

    const localReferences = [...built.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
        .map(([, reference]) => reference.split('?')[0].split('#')[0])
        .filter(reference => reference && !/^(?:[a-z]+:|\/\/|#)/i.test(reference));

    for (const reference of localReferences) {
        await verifyLocalReference(page, reference);
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

const expectedEntries = ['index', 'gallery', 'artwork', 'profile', 'upload', 'collection-builder', 'admin', 'docs-protocol', 'visual-lab', 'generate-favicon'];
for (const entry of expectedEntries) {
    if (!javascriptAssets.some(file => file.startsWith(`${entry}-`))) {
        throw new Error(`Hashed ${entry} entry was not emitted`);
    }
}

// Embed the canonical bitmap in the shared header, with its logical URL intact.
// A separate image request leaves a blank first frame on iPhone reload even when
// hydration never changes src. No hash variant or replacement artwork is allowed.
const sharedHeaderPages = [
    'index.html',
    'gallery.html',
    'artwork.html',
    'profile.html',
    'upload.html',
    'collection-builder.html',
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
const neutralBitmap = await readFile(path.join(dist, componentNeutralAvatar.replace(/^\//, '')));
const inlineNeutralAvatar = `data:image/png;base64,${neutralBitmap.toString('base64')}`;

for (const page of sharedHeaderPages) {
    const built = await readFile(path.join(dist, page), 'utf8');
    const bodyStart = built.indexOf('>', built.indexOf('<body')) + 1;
    if (!built.slice(bodyStart).match(/^\s*<script>document\.body\.classList\.add\(document\.documentElement\.classList\.contains\('future'\) \? 'future' : 'classic'\);<\/script>/)) {
        throw new Error(`${page} must apply the prepaint theme before visible body content`);
    }
    const shellAvatar = built.match(/<img data-avatar-image[^>]*>/)?.[0];
    if (!shellAvatar) {
        throw new Error(`${page} does not ship the static shared-header avatar`);
    }
    if (!shellAvatar.includes(`src="${inlineNeutralAvatar}"`)
        || !shellAvatar.includes(`data-avatar-source="${componentNeutralAvatar}"`)
        || !shellAvatar.includes('loading="eager"')
        || !shellAvatar.includes('decoding="sync"')) {
        throw new Error(`${page} must embed the canonical neutral avatar for eager synchronous paint`);
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
    `Verified ${pages.length} built HTML routes, early social metadata and all three original banner URLs, with no in-browser Babel or async module-entry mount races, `
    + `and one shared neutral avatar (${componentNeutralAvatar}) across ${sharedHeaderPages.length} header pages.`
);
