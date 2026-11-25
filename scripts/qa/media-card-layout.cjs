// Run with playwright-core, WebKit and an H.264-capable Chromium (CHROMIUM_CHANNEL=chrome).
// Optional argument: screenshot folder. ARTSOUL_CARD_CSS=production checks the stylesheet served by the public gallery.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright-core');
const root = path.resolve(__dirname, '../..');
const resources = {
    '/react.js': ['node_modules/react/umd/react.production.min.js', 'text/javascript'],
    '/react-dom.js': ['node_modules/react-dom/umd/react-dom.production.min.js', 'text/javascript'],
    '/cards.js': ['src/ui/components/artwork-card.js', 'text/javascript'],
    '/artwork-url.js': ['src/ui/artwork-url.js', 'text/javascript'],
    '/motion.mp4': ['docs/design/study-assets/motion-demo.mp4', 'video/mp4'],
    '/poster.svg': ['docs/design/study-assets/motion-poster.svg', 'image/svg+xml'],
    '/tone.wav': ['docs/design/study-assets/tone-demo.wav', 'audio/wav'],
    '/brand/artsoul-audio-cover-384.webp': ['public/brand/artsoul-audio-cover-384.webp', 'image/webp'],
    '/brand/base.svg': ['public/brand/base.svg', 'image/svg+xml']
};

async function serverForCards() {
    const gallery = await fs.readFile(path.join(root, 'gallery.html'), 'utf8');
    let deployedCss;
    if (process.env.ARTSOUL_CARD_CSS === 'production') {
        const galleryUrl = 'https://artsoulprotocol.com/gallery';
        const response = await fetch(galleryUrl, {signal:AbortSignal.timeout(15000)});
        assert(response.ok, 'Live gallery returned ' + response.status);
        const [, sheet] = (await response.text()).match(/href="(\/unified-styles\.css(?:\?[^"]*)?)"/) || [];
        assert(sheet, 'Public gallery should link its shared stylesheet');
        const url = new URL(sheet, galleryUrl);
        const css = await fetch(url, {signal:AbortSignal.timeout(15000)});
        assert(css.ok, 'Live CSS returned ' + css.status);
        deployedCss = Buffer.from(await css.arrayBuffer());
        console.log('Checking deployed stylesheet:', url.href);
    }
    const styles = [...gallery.matchAll(/<link rel="stylesheet" href="(\/[\w-]+\.css)(?:\?[^"]*)?">|<style>[\s\S]*?<\/style>/g)].map(match => {
        if (!match[1]) return match[0];
        resources[match[1]] = [match[1].slice(1), 'text/css'];
        return match[0];
    }).join('\n');
    const server = http.createServer(async (req, res) => {
        try {
            const pathname = new URL(req.url, 'http://localhost').pathname;
            if (pathname === '/') {
                res.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:"});
                return res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + styles + '<body><main class="gallery-page-main site-page-container py-6"><div class="gallery-results-grid" id="cards"></div></main><script src="/react.js"></script><script src="/react-dom.js"></script><script src="/artwork-url.js"></script><script src="/cards.js"></script></body></html>');
            }
            if (!Object.hasOwn(resources, pathname)) { res.writeHead(404); return res.end(); }
            const [file, type] = resources[pathname];
            const bytes = pathname === '/unified-styles.css' && deployedCss ? deployedCss : await fs.readFile(path.join(root, file));
            const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
            const start = range ? Number(range[1]) : 0;
            const end = range ? Math.min(Number(range[2] || bytes.length - 1), bytes.length - 1) : bytes.length - 1;
            if (start > end) { res.writeHead(416, {'Content-Range':'bytes */'+bytes.length}); return res.end(); }
            const headers = {'Content-Type':type, 'Accept-Ranges':'bytes', 'Content-Length':end-start+1};
            if (range) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + bytes.length;
            res.writeHead(range ? 206 : 200, headers);
            res.end(bytes.subarray(start, end+1));
        } catch (error) { res.writeHead(500); res.end(); }
    });
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    return server;
}

async function run(engine, name, screenshots, origin) {
    const channel = name === 'chromium' && process.env.CHROMIUM_CHANNEL;
    const browser = await engine.launch(channel ? {channel} : {});
    try {
        for (const [width, height, mobile] of [[320, 700, true], [360, 800, true], [390, 844, true], [430, 932, true], [932, 430, true], [1280, 800, false]]) {
            const context = await browser.newContext({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile });
            let completed = 0, minimumClearance = Infinity, smallestTarget = Infinity;
            try {
                const page = await context.newPage();
                page.setDefaultTimeout(5000);
                for (const theme of ['classic', 'future']) {
                    await page.goto(origin);
                    await page.evaluate(theme => {
                        document.body.className = document.documentElement.className = theme;
                        const api = window.ArtSoulArtworkCard;
                        for (const [i, [renderer, media]] of [
                            ['DOM', 'video'], ['React', 'audio'], ['DOM', 'audio'], ['React', 'video']
                        ].entries()) {
                            const artwork = { artwork_id: i + 1, chain_id: 84532, title: (media === 'audio' ? 'Sound study' : 'Motion study'),
                                creator_name: 'ArtSoul', file_type: media, file_url: media === 'audio' ? '/tone.wav' : '/motion.mp4',
                                poster_url: media === 'video' ? '/poster.svg' : null };
                            const host = document.createElement('div');
                            host.dataset.renderer = renderer;
                            document.getElementById('cards').append(host);
                            const props = { artwork, href: '/artwork/' + artwork.artwork_id };
                            if (renderer === 'React') window.ReactDOM.createRoot(host).render(window.React.createElement(api.ReactCard, props));
                            else host.append(api.createCardElement(artwork, props));
                        }
                    }, theme);
                    await page.waitForFunction(() => document.querySelectorAll('.saved-button-overlay').length === 4);
                    const cards = page.locator('.artsoul-artwork-card');
                    for (const saved of [true, false]) {
                        await cards.locator('.saved-button-overlay').evaluateAll((buttons, visible) => buttons.forEach(b => { b.hidden = !visible; }), saved);
                        for (const card of await cards.all()) {
                            const play = card.locator('.artsoul-media-toggle'), mute = card.locator('.artsoul-media-mute');
                            await play.scrollIntoViewIfNeeded();
                            const measured = await card.evaluate(el => {
                                const find = selector => el.querySelector(selector);
                                const box = e => e.getBoundingClientRect();
                                const preview = box(find('.artsoul-card-preview'));
                                const media = find('.artsoul-card-audio-avatar,video'), art = box(media);
                                const controls = [...el.querySelectorAll('.artsoul-media-toggle,.artsoul-media-mute,.saved-button-overlay')].filter(b => !b.hidden);
                                const badge = box(find('.artsoul-card-audio-label,.artsoul-card-media-badge'));
                                const hit = controls.every(b => { const r = box(b); return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); });
                                const rects = controls.map(box);
                                const inside = r => r.left >= preview.left-.5 && r.right <= preview.right+.5 && r.top >= preview.top-.5 && r.bottom <= preview.bottom+.5;
                                const collides = (a,b) => a.left < b.right-.5 && a.right > b.left+.5 && a.top < b.bottom-.5 && a.bottom > b.top+.5;
                                return { renderer: el.parentElement.dataset.renderer, kind: media.tagName, artWidth: art.width,
                                    cardWidth: preview.width, clearance: Math.min(...rects.map(r => r.top), badge.top) - art.bottom,
                                    inside: [...rects, badge, art].every(inside), hit, minTarget: Math.min(...rects.map(r=>Math.min(r.width,r.height))),
                                    overlap: rects.some((r,i) => [badge,...rects.slice(i+1)].some(next => collides(r,next))),
                                    fit: getComputedStyle(media).objectFit, saved: !!find('.saved-button-overlay').getClientRects().length,
                                    overflow: document.documentElement.scrollWidth > innerWidth,
                                    pageWidth: document.documentElement.scrollWidth, viewport: innerWidth };
                            });
                            const where = JSON.stringify({ name, width, theme, saved, ...measured });
                            assert(measured.artWidth > 45 && measured.hit && measured.inside && !measured.overlap && !measured.overflow, where);
                            assert.equal(measured.saved, saved, where);
                            if (mobile) assert(measured.clearance >= -.5 && measured.minTarget >= (measured.cardWidth > 169 ? 44 : 36) && measured.fit === 'contain', where);
                            minimumClearance = Math.min(minimumClearance, measured.clearance);
                            smallestTarget = Math.min(smallestTarget, measured.minTarget);
                            if (saved) {
                                const media = card.locator('audio,video');
                                const before = await media.evaluate(m => m.muted);
                                const press = el => mobile ? el.tap() : el.click();
                                await press(mute);
                                assert.notEqual(await media.evaluate(m => m.muted), before, where);
                                await press(play);
                                await page.waitForFunction(m => !m.paused && m.currentTime > .1, await media.elementHandle());
                                await press(play);
                                assert(await media.evaluate(m => m.paused), where);
                                assert.equal(page.url(), origin + '/', 'Playback controls must leave the artwork link untouched');
                            }
                            completed++;
                        }
                        if (screenshots && saved && width === 430) {
                            await page.evaluate(() => scrollTo(0,0));
                            await page.screenshot({path:path.join(screenshots,name+'-'+theme+'-430.png'), fullPage:true});
                        }
                    }
                }
                assert.equal(completed, 16, name + ' ' + width + ' needs both functioning audio and video codecs');
                console.log(name, width + 'x' + height, completed, 'card layouts passed', 'minimumGap',minimumClearance,'minimumTarget',smallestTarget);
            } finally { await context.close(); }
        }
    } finally { await browser.close(); }
}

(async () => {
    const screenshots = process.argv[2];
    if (screenshots) await fs.mkdir(screenshots, { recursive: true });
    const server = await serverForCards();
    try {
        const origin = 'http://127.0.0.1:' + server.address().port;
        const results = await Promise.allSettled([run(chromium, 'chromium', screenshots, origin), run(webkit, 'webkit', screenshots, origin)]);
        results.forEach((result, i) => { if (result.status === 'rejected') { console.error(['chromium','webkit'][i], result.reason); process.exitCode = 1; } });
    } finally { server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
