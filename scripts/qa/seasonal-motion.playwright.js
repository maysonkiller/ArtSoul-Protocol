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
            const fog = getComputedStyle(document.getElementById('as-scroll-mist'), '::before');
            const snow = document.getElementById('as-snow-toggle');
            return document.getElementById('as-panel-title').textContent === 'Seasonal studio' &&
                window.ArtSoulSeasonalPreview.getState().locale === 'en' &&
                snow.disabled === !animated && snow.getAttribute('aria-pressed') === String(animated) &&
                document.getElementById('as-preview-fireworks').hidden === !animated &&
                (bulb.animationName !== 'none') === animated && (fog.animationName !== 'none') === animated &&
                frames.includes('weatherFrame') === animated && frames.includes('drawTree') === animated &&
                frames.includes('fireFrame') === fireworks;
        }, { animated, fireworks }, { timeout: 4000 });
    }
    await theme('classic');
    await check(false);
    await theme('future');
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
    return 'Verified Classic, Future, reduced motion, resumed motion and interrupted fireworks.';
}
