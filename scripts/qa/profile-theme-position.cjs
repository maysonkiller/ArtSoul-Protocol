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
            if (url.pathname === '/api/public/artworks') {
                const workId = url.searchParams.get('artwork_id');
                const items = workId ? rows.filter(work => work.artwork_id === Number(workId)) : rows;
                data = { data: items.slice(0, Number(url.searchParams.get('limit') || 200)) };
            }
            if (url.pathname === '/api/public/profile')
                data = { profile: { id: 1, wallet_address: owner, username: 'Studio' } };
            return route.fulfill({ json: data });
        });
        const page = await context.newPage();
        page.setDefaultTimeout(12000);
        await checkDetailControls(page, origin, engine.name());
        for (const route of ['/profile.html?address=' + owner, '/gallery.html#discover']) {
            await page.goto(origin + route, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => document.querySelectorAll('.artsoul-artwork-card audio').length === 28);
            const gallery = route.startsWith('/gallery');
            if (gallery) await page.getByRole('button', { name: 'Price range', exact: true }).click();
            const item = page.locator('.artsoul-artwork-card').nth(13);
            const start = await item.evaluate((card) => {
                const media = card.querySelector('audio');
                window.themeProbe = { card, media };
                scrollTo({ top: card.getBoundingClientRect().top + scrollY - 210, behavior: 'instant' });
                return {
                    top: card.getBoundingClientRect().top,
                    title: card.querySelector('h3').textContent,
                    document: performance.timeOrigin,
                };
            });
            const play = item.locator('.artsoul-media-toggle');
            const sound = item.locator('.artsoul-media-mute');
            const checkClock = async (muted) => {
                const before = await item.locator('.artsoul-card-audio-label').textContent();
                await page.waitForFunction(({ muted, before }) => {
                    const { card, media } = window.themeProbe;
                    const label = card.querySelector('.artsoul-card-audio-label').textContent;
                    return media.isConnected && !media.paused && media.muted === muted &&
                        /^\d+:\d{2}$/.test(label) && label !== before;
                }, { muted, before }).catch(async error => {
                    const state = await item.evaluate(card => {
                        const media = card.querySelector('audio');
                        return { connected: media.isConnected, paused: media.paused, muted: media.muted,
                            duration: media.duration, time: media.currentTime, ready: media.readyState,
                            label: card.querySelector('.artsoul-card-audio-label').textContent, theme: document.body.className };
                    });
                    throw new Error(JSON.stringify({ browser: engine.name(), route, muted, before, state }), { cause: error });
                });
            };
            await play.tap();
            await checkClock(false);
            // iPhone can continue decoding audio between UI time notifications.
            await item.evaluate(card => {
                const audio = card.querySelector('audio');
                document.addEventListener('timeupdate', event => {
                    if (event.target === audio) event.stopImmediatePropagation();
                }, true);
            });
            await sound.tap();
            await checkClock(true);
            for (const theme of ['future', 'classic']) {
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
                    state.same && state.playing && state.muted,
                    JSON.stringify({ route, theme, state })
                );
                assert.equal(state.document, start.document);
                assert.equal(state.title, start.title);
                assert(Math.abs(start.top - state.top) <= 1, JSON.stringify({ route, theme, start, state }));
                if (gallery) assert(await page.getByRole('button', { name: 'Hide price range' }).isVisible());
                await checkClock(true);
                await sound.tap();
                await checkClock(false);
                await sound.tap();
                await checkClock(true);
            }
            await play.tap();
            await sound.tap();
            assert(await item.locator('audio').evaluate(media => media.paused && !media.muted));
            await play.tap();
            await checkClock(false);
            await play.tap();
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

async function checkDetailControls(page, origin, engine) {
    await page.goto(origin + '/artwork/8', { waitUntil: 'domcontentloaded' });
    const player = page.locator('artsoul-media-player:has(audio)');
    const play = player.locator('.artsoul-media-toggle');
    const mute = player.locator('.artsoul-media-mute');
    const clock = player.locator('.ap-time');
    await player.evaluate(player => {
        const media = player.querySelector('audio');
        window.detailProbe = { media, controls: player.querySelector('.ap-controls') };
        // Exercise a sparse native event stream without stopping the real decoder.
        document.addEventListener('timeupdate', event => {
            if (event.target === media) event.stopImmediatePropagation();
        }, true);
    });
    const width = await player.evaluate(element => element.clientWidth);
    await play.tap();
    await page.waitForFunction(() => window.detailProbe.media.currentTime >= 2.1);
    assert.match(await clock.innerText(), /^0:0[1-3] \/ /, engine + ' detail clock during playback');
    for (const theme of ['future', 'classic']) {
        if (theme === 'classic') {
            // Simulate an interruption inside the unmute gesture on a real playing media element.
            await player.locator('audio').evaluate(media => {
                const nativeMute = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted');
                Object.defineProperty(media, 'muted', {
                    configurable: true,
                    get() { return nativeMute.get.call(this); },
                    set(value) {
                        delete this.muted;
                        nativeMute.set.call(this, value);
                        this.pause();
                    },
                });
            });
        }
        await mute.tap();
        await page.locator('[data-artsoul-theme-toggle]').tap();
        await page.waitForFunction(theme => document.body.classList.contains(theme), theme);
        assert(await player.evaluate((player, muted) => {
            const { media, controls } = window.detailProbe;
            return player.querySelector('audio') === media && player.querySelector('.ap-controls') === controls &&
                !media.paused && media.muted === muted;
        }, theme === 'future'));
        const position = await player.locator('audio').evaluate(media => media.currentTime);
        await page.waitForFunction(previous => window.detailProbe.media.currentTime !== previous, position);
    }
    await play.tap();
    await page.waitForFunction(() => window.detailProbe.media.paused);
    await mute.tap();
    await page.waitForFunction(() => window.detailProbe.media.paused && window.detailProbe.media.muted);
    await player.evaluate(element => { element.style.width = '200px'; });
    assert(await clock.isVisible(), 'The compact player retains the playback clock');
    console.log(engine, '/artwork/8', width + 'px player kept its real clock, controls and audio across both themes');
}

(async () => {
    const { preview } = await import('vite');
    const silence = await readSilentAudio(30);
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
