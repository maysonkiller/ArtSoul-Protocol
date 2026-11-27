// Browser rehearsal for the real admin components. All reads and writes go to the in-memory fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright-core');

const origin = 'https://admin-fixture.artsoul.test';
const wallet = '0x' + '1'.repeat(40);
const issuer = '0x' + '2'.repeat(40);
const collection = '0x' + '3'.repeat(40);
const core = '0x' + '4'.repeat(40);
const genesis = '0x' + '5'.repeat(40);

async function bundle() {
    const { build } = await import('vite');
    const entry = 'virtual:frame-admin';
    const fixture = `
        import { React, createRoot } from '/src/entries/react-runtime.js';
        import { AuraAppearance } from '/src/features/admin/aura-appearance.jsx';
        const query = new URLSearchParams(location.search);
        const api = async (path, options) => {
            const response = await fetch('/api/' + path, options);
            const data = await response.json();
            if (!response.ok) throw Error(data.message);
            return data;
        };
        createRoot(document.getElementById('app')).render(React.createElement(AuraAppearance, {
            api, wallet: '${wallet}', frameSourceManager: query.has('manager'), isSessionCurrent: () => true
        }));`;
    const built = await build({ configFile: false, logLevel: 'error',
        plugins: [{name:'frame-admin-fixture', resolveId: id => id === entry ? '\0' + entry : null,
            load: id => id === '\0' + entry ? fixture : null}],
        build: {write:false, minify:false, rollupOptions:{input:entry}}
    });
    return built.output.find(file => file.isEntry).code;
}

async function main() {
    const js = await bundle();
    const css = (await Promise.all(['design-system.css','unified-styles.css','src/features/admin/workspace.css']
        .map(file => fs.readFile(file,'utf8')))).join('\n');
    const browser = await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
    try {
        for (const [theme,width] of [['classic',320],['future',430],['future',1440]]) {
            const page = await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'});
            const writes = [];
            const states = new Map();
            let pinned = null;
            let failNext = false;
            let sourcesEnabled = true;
            await page.route('**/*',async route => {
                const url = new URL(route.request().url());
                if (url.origin !== origin) return route.abort();
                if (url.pathname === '/') return route.fulfill({contentType:'text/html',body:
                    '<!DOCTYPE html><html lang="en" class="' + theme + '"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/fixture.css"><body class="protocol-admin-page ' + theme +
                    '"><main id="app" class="protocol-admin-shell admin-workspace"></main><script type="module" src="/fixture.js"></script>'});
                if (url.pathname === '/fixture.js') return route.fulfill({contentType:'text/javascript',body:js});
                if (url.pathname === '/fixture.css') return route.fulfill({contentType:'text/css',body:css});
                if (url.pathname === '/brand/artsoul-audio-cover-384.webp') return route.fulfill({path:'public/brand/artsoul-audio-cover-384.webp'});
                if (url.pathname === '/api/aura-border') return route.fulfill({json:{enabled:true,revision:1,sourcesEnabled}});
                if (url.pathname === '/api/public/search') return route.fulfill({json:{
                    query:url.searchParams.get('q'),category:'artists',nextCursor:null,
                    groups:{artists:{items:[{username:'Example artist',wallet_address:issuer}],hasMore:false},
                        artworks:{items:[],hasMore:false},auctions:{items:[],hasMore:false}}
                }});
                if (url.pathname !== '/api/aura-sources') return route.abort();
                const {kind,chain,deployment,address,issuer:originator} = Object.fromEntries(url.searchParams);
                const publisher = ['platform','founder'].includes(kind);
                if (publisher && chain === '8453') return route.fulfill({status:503,json:{message:'The active publishing contract has not been configured.'}});
                const scope = publisher ? core : originator || '';
                const key = [kind,chain,scope,address].join('/');
                if (route.request().method() === 'POST') {
                    const body = route.request().postDataJSON();
                    writes.push({kind,chain,deployment,address,originator,body});
                    if (failNext) {
                        failNext=false;
                        return route.fulfill({status:409,json:{message:'Another reviewer changed the source. Reload it.'}});
                    }
                    states.set(key,{address,enabled:body.enabled,revision:body.revision+1});
                }
                return route.fulfill({json:{scope,configuredGenesis:pinned,
                    sources:address ? [states.get(key) || {address,enabled:false,revision:0}] : [],next:null}});
            });
            await page.goto(origin);
            await page.getByText(/Frame sources can be managed by/).waitFor();
            assert.equal(await page.getByText('Manage frame sources',{exact:true}).count(),0);
            sourcesEnabled=false;
            await page.goto(origin+'/?manager');
            await page.getByText(/Frame sources can be managed by/).waitFor();
            assert.equal(await page.getByText('Manage frame sources',{exact:true}).count(),0);
            sourcesEnabled=true;
            await page.reload();
            await page.getByText('Manage frame sources',{exact:true}).click();
            const button = name => page.getByRole('button',{name,exact:true});
            const field = label => page.getByLabel(label,{exact:true});
            const reason = field('Reason for the change');
            const kind = field('Frame source');
            await field('Artist wallet or profile name').fill('Example artist');
            await button('Find profile').click();
            await button('Example artist / ' + issuer).click();
            await reason.waitFor();
            assert.equal(await field('Artist wallet or profile name').inputValue(),issuer);
            await button('Use my wallet').click();
            await page.getByText('Disabled / ' + wallet,{exact:true}).waitFor();
            assert(await button('Enable frame source').isDisabled());
            await reason.fill('Personal artist publications');
            await button('Enable frame source').click();
            await page.getByText('Frame source enabled.').waitFor();
            assert.deepEqual(writes.at(-1),{kind:'founder',chain:'84532',deployment:'catalog',address:wallet,originator:undefined,
                body:{scope:core,enabled:true,revision:0,reason:'Personal artist publications'}});
            await reason.fill('Designation retired');
            await button('Disable frame source').click();
            await page.getByText('Frame source disabled.').waitFor();
            assert.equal(writes.at(-1).body.revision,1);
            await kind.selectOption('platform');
            await field('Publishing contract').selectOption('rehearsal');
            await button('Use my wallet').click();
            await reason.fill('Reviewed test publisher');
            failNext=true;
            await button('Enable frame source').click();
            await page.getByText('Another reviewer changed the source. Reload it.').waitFor();
            assert.equal(writes.at(-1).deployment,'rehearsal');
            assert.equal(await reason.count(),0);
            await field('Network').selectOption('8453');
            assert.equal(await field('Publishing contract').locator('option').count(),1);
            await button('Use my wallet').click();
            await page.getByText('The active publishing contract has not been configured.').waitFor();
            assert.equal(await reason.count(),0);
            await kind.selectOption('official_collection');
            assert.equal(await button('Check address').count(),0);
            await field('Original collection issuer wallet').fill(issuer);
            await field('NFT collection contract').fill(collection);
            await button('Check address').click();
            await reason.fill('Approved project collection');
            await button('Enable frame source').click();
            await page.getByText('Frame source enabled.').waitFor();
            assert.equal(writes.at(-1).originator,issuer);
            assert.equal(writes.at(-1).address,collection);
            assert.equal(writes.at(-1).body.scope,issuer);
            if (process.env.ARTSOUL_QA_SCREENSHOTS) {
                const directory=process.env.ARTSOUL_QA_SCREENSHOTS;
                await fs.mkdir(directory,{recursive:true});
                await page.screenshot({path:path.join(directory,`frame-admin-${theme}-${width}.png`),fullPage:true});
            }
            await kind.selectOption('partner');
            await field('Network').selectOption('84532');
            await field('NFT collection contract').fill(collection);
            await button('Check address').click();
            await reason.fill('Verified partner collection');
            await button('Enable frame source').click();
            await page.getByText('Frame source enabled.').waitFor();
            assert.equal(writes.at(-1).body.scope,'');
            assert.equal(writes.at(-1).chain,'84532');
            await kind.selectOption('genesis');
            assert.equal(await page.locator('.admin-frame-sources input').count(),0);
            await button('Check Genesis deployment').click();
            await page.getByText('The Base mainnet Genesis deployment has not been configured.').waitFor();
            pinned=genesis;
            await button('Check Genesis deployment').click();
            await button(genesis).click();
            await reason.fill('Reviewed mainnet deployment');
            await button('Enable frame source').click();
            await page.getByText('Frame source enabled.').waitFor();
            assert.equal(writes.at(-1).kind,'genesis');
            assert.equal(writes.at(-1).chain,'8453');
            assert.equal(writes.at(-1).address,pinned);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
            await page.close();
            console.log(theme + ' ' + width + 'px: permission, source, conflict and mobile width checks passed.');
        }
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode=1; });
