// Exercise the real reviewer UI with in-memory applicants. No staff accounts or network writes.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright-core');

const origin = 'https://identity-review.artsoul.test';
const own = '0x' + '1'.repeat(40);
const other = '0x' + '2'.repeat(40);

async function main() {
    const { build } = await import('vite');
    const entry = 'virtual:identity-review';
    const source = `
        import { React, createRoot } from '/src/entries/react-runtime.js';
        import { usePendingIdentityReviews, IdentityReviews } from '/src/features/admin/identity-reviews.jsx';
        const h = React.createElement;
        const api = async (path, options) => {
            const res = await fetch('/api/' + path, options);
            if (!res.ok) throw Error('Fixture read failed');
            return res.json();
        };
        function Workspace() {
            const [authorized,setAuthorized] = React.useState(false);
            const [inbox,setInbox] = React.useState(false);
            const summary = usePendingIdentityReviews({api,wallet:authorized ? '${own}' : '',epoch:1});
            return h(React.Fragment, null,
                h('button',{onClick:()=>setAuthorized(!authorized)}, authorized ? 'Lock' : 'Verify'),
                authorized && h('button',{onClick:()=>setInbox(!inbox)}, 'Identity reviews'),
                authorized && h('output',{'data-actionable':summary.needsReview},summary.label),
                authorized && inbox && h(IdentityReviews,{wallet:'${own}',api,isSessionCurrent:()=>authorized,onQueueChange:summary.refresh}));
        }
        createRoot(document.querySelector('main')).render(h(Workspace));
    `;
    const built = await build({configFile:false,logLevel:'error',
        plugins:[{name:'identity-review-fixture',resolveId:id=>id===entry ? '\0'+entry : null,load:id=>id==='\0'+entry ? source : null}],
        build:{write:false,rollupOptions:{input:entry}}});
    const js = built.output.find(file => file.isEntry).code;
    const css = (await Promise.all(['design-system.css','unified-styles.css','src/features/admin/workspace.css'].map(file => fs.readFile(file,'utf8')))).join('\n');
    const browser = await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,args:['--mute-audio']});
    try {
        for (const [theme,width] of [['classic',320],['future',430],['future',1440]]) {
            const page = await browser.newPage({viewport:{width,height:850}, reducedMotion:'reduce'});
            const requests = [], writes = [];
            let fail = false;
            const rows = [own,other].map((wallet,i)=>({wallet,id:String(i+1),profile_name:'Artist '+(i+1),
                chain_id:null,evidence:'https://artist.example/proof/'+'x'.repeat(80),status:'pending'}));
            await page.route('**/*', async route => {
                const url = new URL(route.request().url());
                if (url.origin !== origin) return route.abort();
                if (url.pathname === '/') return route.fulfill({contentType:'text/html',body:
                    '<html lang="en" class="'+theme+'"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style></head><body class="'+theme+' protocol-admin-page"><main class="protocol-admin-shell admin-workspace"></main><script type="module" src="/fixture.js"></script></body></html>'});
                if (url.pathname === '/fixture.js') return route.fulfill({contentType:'text/javascript',body:js});
                if (url.pathname !== '/api/identity-reviews') return route.abort();
                const params=url.searchParams;
                assert.equal(params.get('wallet'),own);
                requests.push(params);
                if (route.request().method()==='POST') {
                    const decision=route.request().postDataJSON();
                    assert.equal(decision.id,'2');
                    writes.push(decision);
                    rows[1].status='approved';
                    return route.fulfill({json:{id:decision.id,action:decision.action}});
                }
                const pending=rows.filter(row=>row.status==='pending');
                if (params.has('summary')) return route.fulfill({json:{pending:pending.length,hasMore:false,needsReview:pending.some(row=>row.wallet!==own)}});
                if (fail) { fail=false; return route.fulfill({status:503,json:{}}); }
                return route.fulfill({json:{applications:rows.filter(row=>row.status===params.get('status')),next:null}});
            });
            await page.goto(origin);
            const button=name=>page.getByRole('button',{name,exact:true});
            await button('Verify').waitFor();
            assert.equal(requests.length,0);
            await button('Verify').click();
            await page.locator('output[data-actionable="true"]').filter({hasText:'2'}).waitFor();
            assert.equal(requests.length,1);
            await button('Identity reviews').click();
            const myRequest=page.getByRole('article',{name:'Artist 1'});
            await myRequest.getByText('This request belongs to your wallet.').waitFor();
            assert.equal(await myRequest.getByRole('button').count(),0);
            const note=page.getByLabel('Decision note');
            assert(await button('Approve').isDisabled());
            await note.fill('Official source matches the profile.');
            await button('Refresh requests').click();
            await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Approve').disabled);
            assert.equal(await note.inputValue(),'Official source matches the profile.');
            assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow at '+width);
            if (process.env.ARTSOUL_QA_SCREENSHOTS) {
                await page.screenshot({path:path.join(process.env.ARTSOUL_QA_SCREENSHOTS,'identity-review-'+theme+'-'+width+'.png'),fullPage:true});
            }
            await button('Approve').click();
            await page.getByText('Decision saved for request #2.').waitFor();
            await page.locator('output[data-actionable="false"]').filter({hasText:'1'}).waitFor();
            assert.deepEqual(writes,[{id:'2',action:'approve',note:'Official source matches the profile.'}]);
            fail=true;
            await page.getByLabel('Request status').selectOption('approved');
            await page.getByRole('alert').waitFor();
            await button('Refresh requests').click();
            await button('Revoke').waitFor();
            assert(await button('Revoke').isDisabled());
            await button('Lock').click();
            assert.equal(await page.getByRole('article').count(),0);
            await page.close();
            console.log(theme+' '+width+'px: gated count, self-review, draft, decision and retry passed');
        }
    } finally { await browser.close(); }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
