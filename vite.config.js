import { cp, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(root, 'dist');

const pageInputs = {
    index: 'index.html',
    gallery: 'gallery.html',
    artwork: 'artwork.html',
    profile: 'profile.html',
    upload: 'upload.html',
    'docs-protocol': 'docs-protocol.html',
    'visual-lab': 'visual-lab.html',
    'generate-favicon': 'generate-favicon.html'
};

const legacyRootAssets = [
    '1080x360.png',
    'ai-ui-styles.css',
    'appkit-init.js',
    'artsoul-social-preview.png',
    'ARTSOULlogo-clean.png',
    'ARTSOULlogo.png',
    'artwork-card-fixes.css',
    'avatar-dropdown.js',
    'button-effects.css',
    'contracts-config.js',
    'contracts-integration.js',
    'default-avatar.png',
    'design-system.css',
    'favicon.jpg',
    'ipfs-client.js',
    'mobile-no-motion.css',
    'mobile-responsive.css',
    'modal-system.js',
    'oauth-integration.js',
    'performance-optimizations.css',
    'simplified-ui.css',
    'styles.css',
    'supabase-auth.js',
    'supabase-client.js',
    'theme-sync.js',
    'ui-core.css',
    'unified-styles.css'
];

const legacyClientTrees = [
    'src/ai',
    'src/core',
    'src/features',
    'src/services',
    'src/ui'
];

const legacyClientFiles = [
    'src/index.js',
    'src/services-index.js'
];

async function copyRelative(relativePath) {
    const source = path.join(root, relativePath);
    const destination = path.join(outDir, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
}

function keepLegacyRuntimeModulesSeparate() {
    return {
        name: 'keep-legacy-runtime-modules-separate',
        apply: 'build',
        transformIndexHtml: {
            order: 'pre',
            handler(html) {
                return html.replace(
                    /<script type="module"(?![^>]*\/src\/entries\/)([^>]*)><\/script>/g,
                    '<script type="application/x-artsoul-module" data-artsoul-legacy-module$1></script>'
                );
            }
        },
        async closeBundle() {
            await Promise.all(Object.values(pageInputs).map(async (page) => {
                const outputPath = path.join(outDir, page);
                const output = await readFile(outputPath, 'utf8');
                await writeFile(
                    outputPath,
                    output.replaceAll(
                        'type="application/x-artsoul-module" data-artsoul-legacy-module',
                        'type="module"'
                    )
                );
            }));
        }
    };
}

function copyLegacyRuntimeAssets() {
    return {
        name: 'copy-legacy-runtime-assets',
        apply: 'build',
        async closeBundle() {
            await Promise.all([...legacyRootAssets, ...legacyClientFiles].map(copyRelative));
            await Promise.all(legacyClientTrees.map(async (relativePath) => {
                const destination = path.join(outDir, relativePath);
                await mkdir(path.dirname(destination), { recursive: true });
                await cp(path.join(root, relativePath), destination, { recursive: true });
            }));

            const outputPages = new Set(await readdir(outDir));
            for (const page of Object.values(pageInputs)) {
                if (!outputPages.has(page)) throw new Error(`Missing built page: ${page}`);
            }
        }
    };
}

export default defineConfig({
    appType: 'mpa',
    plugins: [react(), keepLegacyRuntimeModulesSeparate(), copyLegacyRuntimeAssets()],
    build: {
        outDir,
        emptyOutDir: true,
        manifest: true,
        sourcemap: false,
        target: 'es2020',
        rollupOptions: {
            input: Object.fromEntries(
                Object.entries(pageInputs).map(([name, page]) => [name, path.join(root, page)])
            ),
            output: {
                manualChunks(id) {
                    if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
                        return 'vendor-react';
                    }
                }
            },
            onwarn(warning, warn) {
                if (warning.message.includes('can\'t be bundled without type="module" attribute')) return;
                warn(warning);
            }
        }
    }
});
