import { cp, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(root, 'dist');

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
    'docs_sections.json',
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

const pilotLegacyModules = [
    'supabase-auth.js',
    'supabase-client.js',
    'appkit-init.js'
];

function keepPilotLegacyModulesSeparate() {
    return {
        name: 'keep-pilot-legacy-modules-separate',
        apply: 'build',
        transformIndexHtml: {
            order: 'pre',
            handler(html) {
                for (const moduleName of pilotLegacyModules) {
                    html = html.replace(
                        new RegExp(`<script type="module" src="(${moduleName.replace('.', '\\.')}(?:\\?[^\"]*)?)"><\\/script>`),
                        '<script type="application/x-artsoul-module" data-artsoul-legacy-module src="$1"></script>'
                    );
                }
                return html;
            }
        },
        async closeBundle() {
            const docsOutputPath = path.join(outDir, 'docs.html');
            const docsOutput = await readFile(docsOutputPath, 'utf8');
            await writeFile(
                docsOutputPath,
                docsOutput.replaceAll(
                    'type="application/x-artsoul-module" data-artsoul-legacy-module',
                    'type="module"'
                )
            );
        }
    };
}

function preserveUnmigratedPages() {
    return {
        name: 'preserve-unmigrated-pages',
        apply: 'build',
        async closeBundle() {
            await Promise.all([...legacyPages, ...legacyRootAssets, ...legacyClientFiles].map(copyRelative));
            await Promise.all(legacyClientTrees.map(async (relativePath) => {
                const destination = path.join(outDir, relativePath);
                await mkdir(path.dirname(destination), { recursive: true });
                await cp(path.join(root, relativePath), destination, { recursive: true });
            }));

            // Fail early if a future page adds a new root-level browser asset that the
            // preservation list does not deploy. This keeps the mixed migration explicit.
            const outputPages = new Set(await readdir(outDir));
            for (const page of legacyPages) {
                if (!outputPages.has(page)) {
                    throw new Error(`Missing preserved page: ${page}`);
                }
            }
        }
    };
}

export default defineConfig({
    appType: 'mpa',
    plugins: [react(), keepPilotLegacyModulesSeparate(), preserveUnmigratedPages()],
    build: {
        outDir,
        emptyOutDir: true,
        manifest: true,
        sourcemap: false,
        target: 'es2020',
        rollupOptions: {
            input: {
                docs: path.join(root, 'docs.html')
            },
            onwarn(warning, warn) {
                if (warning.message.includes('can\'t be bundled without type="module" attribute')) return;
                warn(warning);
            }
        }
    }
});
