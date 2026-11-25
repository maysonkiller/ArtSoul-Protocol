// Build the site first. Both actual page entries run on loopback. The media sample is silent PCM.
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const readSilentAudio = require('./silent-audio.cjs');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright-core');

const owner = '0x' + '1'.repeat(40);
const releases = Array.from({ length: 28 }, (_, i) => ({
    id: 'v41:84532:' + (28 - i),
    artwork_id: 28 - i,
    chain_id: 84532,
    creator_id: owner,
    creator: owner,
    source: 'v41_projection',
    status: 'registered',
    title: 'Sound study ' + (28 - i),
    file_type: 'audio',
    created_at: new Date(Date.UTC(2026, 9, 28 - i)).toISOString(),
}));

async function checkEngine(engine, origin) {
    const browser = await engine.launch();
    try {
        const context = await browser.newContext({
            viewport: { width: 430, height: 932 },
            isMobile: true,
            hasTouch: true,
        });
        // Serve the same storage policy with the origin of the isolated media fixture.
        const storagePolicy = (await readFile(path.join(__dirname, '../../storage-image.js'), 'utf8')).replace(
            "const ALLOWED_STORAGE_DOMAIN = 'bexigvqrunomwtjsxlej.supabase.co'",
            "const ALLOWED_STORAGE_DOMAIN = '127.0.0.1'"
        );
        const rows = releases.map((work) => ({
            ...work,
            file_url: origin + '/qa-silence.wav?work=' + work.artwork_id,
        }));
        await context.route('**/*', (route) => {
            const url = new URL(route.request().url());
            if (url.origin !== origin) return route.abort();
            if (url.pathname === '/storage-image.js')
                return route.fulfill({ contentType: 'text/javascript', body: storagePolicy });
            if (!url.pathname.startsWith('/api/')) return route.continue();
            let data = {};
            if (url.pathname === '/api/public/artworks')
                data = { data: rows.slice(0, Number(url.searchParams.get('limit') || 200)) };
            if (url.pathname === '/api/public/profile')
                data = { profile: { id: 1, wallet_address: owner, username: 'Studio' } };
            return route.fulfill({ json: data });
        });
        const page = await context.newPage();
        page.setDefaultTimeout(12000);
        for (const route of ['/profile.html?address=' + owner, '/gallery.html#discover']) {
            await page.goto(origin + route, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => document.querySelectorAll('.artsoul-artwork-card audio').length === 28);
            const gallery = route.startsWith('/gallery');
            if (gallery) await page.getByRole('button', { name: 'Price range', exact: true }).click();
            const item = page.locator('.artsoul-artwork-card').nth(13);
            const start = await item.evaluate((card) => {
                const media = card.querySelector('audio');
                media.muted = true;
                media.loop = true;
                window.themeProbe = { card, media };
                scrollTo({ top: card.getBoundingClientRect().top + scrollY - 210, behavior: 'instant' });
                return {
                    top: card.getBoundingClientRect().top,
                    title: card.querySelector('h3').textContent,
                    document: performance.timeOrigin,
                };
            });
            await item.locator('.artsoul-media-toggle').tap();
            await page.waitForFunction(() => window.themeProbe.media.currentTime > 0.15);
            for (const theme of ['future', 'classic']) {
                const before = await page.evaluate(() => window.themeProbe.media.currentTime);
                await page.locator('[data-artsoul-theme-toggle]').tap();
                await page.waitForFunction((theme) => document.body.classList.contains(theme), theme);
                const state = await item.evaluate((card) => {
                    const { media } = window.themeProbe;
                    return {
                        same: window.themeProbe.card === card && media === card.querySelector('audio'),
                        playing: !media.paused,
                        muted: media.muted,
                        time: media.currentTime,
                        top: card.getBoundingClientRect().top,
                        title: card.querySelector('h3').textContent,
                        document: performance.timeOrigin,
                    };
                });
                assert(
                    state.same && state.playing && state.muted && state.time >= before,
                    JSON.stringify({ route, theme, state })
                );
                assert.equal(state.document, start.document);
                assert.equal(state.title, start.title);
                assert(Math.abs(start.top - state.top) <= 1, JSON.stringify({ route, theme, start, state }));
                if (gallery) assert(await page.getByRole('button', { name: 'Hide price range' }).isVisible());
            }
            await page.evaluate(() => window.themeProbe.media.pause());
            console.log(
                engine.name(),
                route.split('?')[0],
                'both theme changes kept the card, scroll position and playing audio'
            );
        }
    } finally {
        await browser.close();
    }
}

(async () => {
    const { preview } = await import('vite');
    const silence = await readSilentAudio();
    const fixture = {
        name: 'silent-audio',
        configurePreviewServer(server) {
            server.middlewares.use('/qa-silence.wav', (req, res) => {
                const [, first, last] = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '') || [];
                const start = Number(first || 0),
                    end = Math.min(Number(last || silence.length - 1), silence.length - 1);
                if (start > end) {
                    res.writeHead(416, { 'Content-Range': 'bytes */' + silence.length });
                    return res.end();
                }
                const headers = {
                    'Content-Type': 'audio/wav',
                    'Accept-Ranges': 'bytes',
                    'Content-Length': end - start + 1,
                };
                if (first) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + silence.length;
                res.writeHead(first ? 206 : 200, headers);
                res.end(silence.subarray(start, end + 1));
            });
        },
    };
    const server = await preview({ preview: { host: '127.0.0.1', port: 0 }, plugins: [fixture], logLevel: 'error' });
    try {
        const origin = new URL(server.resolvedUrls.local[0]).origin;
        await Promise.all([checkEngine(chromium, origin), checkEngine(webkit, origin)]);
    } finally {
        await new Promise((resolve) => server.httpServer.close(resolve));
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
