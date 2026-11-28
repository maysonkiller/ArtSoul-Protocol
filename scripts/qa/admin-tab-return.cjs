// Full page regression for a staff reviewer opening another tab to copy evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright-core');

async function main() {
    const { build } = await import('vite');
    const built = await build({ configFile: false, logLevel: 'error',
        build: { write: false, rollupOptions: { input: 'src/entries/admin.jsx', output: { inlineDynamicImports: true } } } });
    const entry = built.output.find(file => file.isEntry).code;
    const css = (await Promise.all(['design-system.css', 'unified-styles.css', 'src/features/admin/workspace.css']
        .map(file => fs.readFile(file, 'utf8')))).join('\n');
    const wallet = '0x' + '1'.repeat(40);
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--mute-audio'] });
    try {
        for (const [theme, width] of [['classic', 320], ['future', 430], ['classic', 1440], ['future', 1440]]) {
            const page = await browser.newPage({ viewport: { width, height: 760 }, reducedMotion: 'reduce' });
            await page.addInitScript(address => {
                window.artsoulWalletStateSettled = true;
                window.getCurrentWalletAddress = () => address;
                window.SupabaseAuth = { getAuthenticatedWallet: () => address };
            }, wallet);
            let hold, revoked = false, checkCount = 0;
            await page.route('**/*', async route => {
                const url = new URL(route.request().url());
                if (url.origin !== 'https://workspace.artsoul.test' || route.request().method() !== 'GET') return route.abort();
                if (url.pathname === '/admin') return route.fulfill({contentType:'text/html', body:
                    '<!doctype html><html lang="en" class="'+theme+'"><meta name="viewport" content="width=device-width"><style>'+css+'</style><body class="protocol-admin-page '+theme+'"><main id="app"></main><script type="module" src="/page.js"></script></body></html>'});
                if (url.pathname === '/page.js') return route.fulfill({contentType:'text/javascript',body:entry});
                if (url.pathname.endsWith('/access')) {
                    checkCount++;
                    if (hold) await hold;
                    const now = Date.now();
                    return route.fulfill({json:{authenticated:true, eligible:!revoked, enabled:true,setupEnabled:true,serverTime:now,
                        access:revoked ? null : {role:'admin',dualWallet:true,identityReviewer:true,stepUpActive:true,stepUpExpiresAt:now+120000}}});
                }
                if (url.pathname.endsWith('/review-queue')) return route.fulfill({json:{data:{reports:[],events:[],hidden:[],moderationLog:[],notifications:[]}}});
                if (url.pathname.endsWith('/identity-reviews')) return route.fulfill({json:url.searchParams.has('summary')
                    ? {pending:1,needsReview:true,hasMore:false}
                    : {applications:[{id:'1',profile_name:'Example artist',wallet:'0x'+'2'.repeat(40),status:'pending',evidence:'https://artist.example/'}]}});
                return route.abort();
            });
            await page.goto('https://workspace.artsoul.test/admin#identity-reviews');
            const note = page.getByLabel('Decision note'), draft = 'Profile matches the official source.';
            await note.fill(draft);
            const scroll = await page.evaluate(() => scrollY);
            let release;
            hold = new Promise(resolve => { release = resolve; });
            const returnToTab = () => page.evaluate(() => {
                window.dispatchEvent(new Event('blur'));
                window.dispatchEvent(new Event('focus'));
            });
            await returnToTab();
            await page.locator('.admin-private-workspace[inert]').waitFor({state:'attached'});
            assert.equal(await note.isVisible(), false);
            assert.equal(await page.evaluate(() => scrollY), scroll);
            release(); hold = null;
            await note.waitFor();
            assert.equal(await note.inputValue(), draft);
            assert.equal(checkCount, 2);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            if (process.env.ARTSOUL_QA_SCREENSHOT_DIR) await page.screenshot({path:process.env.ARTSOUL_QA_SCREENSHOT_DIR+'/admin-'+theme+'-'+width+'.png'});
            revoked = true;
            await returnToTab();
            await page.getByRole('heading',{name:'Access unavailable'}).waitFor();
            assert.equal(await note.count(), 0);
            await page.close();
            console.log(theme, width, 'draft restored, revoked session cleared');
        }
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
