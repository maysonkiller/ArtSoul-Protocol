// Run with Playwright CLI on a locally served production build's homepage.
async page => {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(page.url()).hostname)) {
        throw new Error('Open a locally served homepage in a disposable browser session.');
    }
    await page.addInitScript(() => {
        localStorage.setItem('artsoul_seasonal_preview_mode', 'newyear');
        localStorage.setItem('artsoul_seasonal_preview_snow', 'on');
        const pending = new Map();
        window.seasonalTestFrames = pending;
        const request = window.requestAnimationFrame.bind(window);
        const cancel = window.cancelAnimationFrame.bind(window);
        window.requestAnimationFrame = callback => {
            const id = request(time => { pending.delete(id); callback(time); });
            pending.set(id, callback.name);
            return id;
        };
        window.cancelAnimationFrame = id => { pending.delete(id); cancel(id); };
    });
    await page.bringToFront();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.reload();
    await page.waitForFunction(() => window.ArtSoulSeasonalPreview);
    const theme = name => page.evaluate(name => {
        if (typeof window.setTheme === 'function') window.setTheme(name);
        else for (const node of [document.documentElement, document.body]) {
            node.classList.remove('classic', 'future');
            node.classList.add(name);
        }
        document.documentElement.lang = 'ru';
    }, name);
    async function check(animated, fireworks = false) {
        await page.waitForFunction(({ animated, fireworks }) => {
            const frames = [...window.seasonalTestFrames.values()];
            const bulb = getComputedStyle(document.querySelector('#as-header-ornament .as-bulb'));
            const twinkling = Array.from(document.querySelectorAll('#as-header-ornament .as-bulb'))
                .filter(node => getComputedStyle(node).animationName !== 'none').length;
            const fog = getComputedStyle(document.getElementById('as-scroll-mist'), '::before');
            const snow = document.getElementById('as-snow-toggle');
            return document.getElementById('as-panel-title').textContent === 'Seasonal studio' &&
                window.ArtSoulSeasonalPreview.getState().locale === 'en' &&
                snow.disabled === !animated && snow.getAttribute('aria-pressed') === String(animated) &&
                document.getElementById('as-preview-fireworks').hidden === !animated &&
                (bulb.animationName !== 'none') === animated && twinkling <= 6 &&
                (fog.animationName !== 'none') === animated &&
                frames.includes('weatherFrame') === animated && frames.includes('drawTree') === animated &&
                frames.includes('fireFrame') === fireworks;
        }, { animated, fireworks }, { timeout: 4000 });
    }
    await theme('classic');
    await check(false);
    await theme('future');
    const tree = page.locator('#as-tree-canvas');
    await tree.scrollIntoViewIfNeeded();
    await check(true);
    await page.evaluate(() => {
        const mock = document.createElement('div');
        mock.id = 'seasonal-test-covers';
        mock.innerHTML = '<span class="artsoul-card-audio-avatar" data-playing="false"></span><span class="artsoul-card-audio-avatar" data-playing="true"></span>';
        document.body.append(mock);
    });
    await page.waitForFunction(() => {
        const frames = [...window.seasonalTestFrames.values()];
        const bulb = document.querySelector('#as-header-ornament .as-bulb');
        return document.body.hasAttribute('data-as-ambient-idle') &&
            !frames.includes('weatherFrame') && !frames.includes('drawTree') &&
            getComputedStyle(bulb).animationPlayState === 'paused' &&
            getComputedStyle(document.querySelector('h1')).animationPlayState === 'paused' &&
            getComputedStyle(document.querySelector('#seasonal-test-covers [data-playing="false"]')).animationPlayState === 'paused' &&
            getComputedStyle(document.querySelector('#seasonal-test-covers [data-playing="true"]')).animationPlayState !== 'paused' &&
            !document.getElementById('as-snow-toggle').disabled;
    }, null, { timeout: 28000 });
    await page.mouse.move(8, 8);
    await check(true);
    await page.evaluate(() => document.getElementById('seasonal-test-covers').remove());
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
    await page.waitForFunction(() => document.getElementById('as-tree-canvas').getBoundingClientRect().bottom <= 0 &&
        ![...window.seasonalTestFrames.values()].includes('drawTree'));
    await tree.scrollIntoViewIfNeeded();
    await check(true);
    await page.evaluate(() => window.ArtSoulSeasonalPreview.previewFireworks());
    await check(true, true);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await check(false);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await check(true);
    await page.evaluate(() => window.ArtSoulSeasonalPreview.previewFireworks());
    await theme('classic');
    await check(false);
    await page.goto(new URL('/gallery', page.url()).href);
    await theme('future');
    const imageAnimation = await page.evaluate(async () => {
        const image = new Image(1, 1);
        image.loading = 'lazy';
        image.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
        document.body.prepend(image);
        await image.decode();
        const animation = getComputedStyle(image).animationName;
        image.remove();
        return animation;
    });
    if (imageAnimation !== 'none') throw new Error('A decoded gallery image still animates in Future.');
    return 'Verified seasonal motion in both themes, idle and offscreen pause, interaction resume, sparse twinkles, interrupted fireworks and static gallery images.';
}
