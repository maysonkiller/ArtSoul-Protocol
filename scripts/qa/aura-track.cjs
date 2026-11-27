// Run after the site build. Playwright needs Chromium and WebKit installed.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium, webkit} = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright-core');
const dist = path.resolve(process.env.ARTSOUL_QA_DIST || 'dist');
const origin = 'https://fixture.artsoul.test';
const image = 'https://bexigvqrunomwtjsxlej.supabase.co/storage/v1/object/public/artworks/track.png';
const artist = '0x' + '1'.repeat(40);
const artwork = {
    id:'v41:84532:13', chain_id:84532, artwork_id:'13', blockchain_id:'13', source:'v41_projection',
    minted:true, status:'sold', token_id:'1', aura_kind:'platform', aura_border_text:true, ownership_status:'verified',
    title:'Track study', creator:artist, creator_id:artist, current_owner_address:artist, creator_name:'Test artist',
    media_type:'image', file_type:'image', image, media_url:image, file_url:image, floor_price:'0.001'
};
const mime = {'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png'};

async function serveBuild(route, work) {
    const url = new URL(route.request().url());
    if (route.request().resourceType() === 'media') return route.abort();
    if (url.host === new URL(image).host && route.request().resourceType() === 'image') {
        return route.fulfill({path:path.resolve('public/brand/artsoul-audio-cover-384.webp'),contentType:'image/webp'});
    }
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/')) {
        const fixtures = {
            '/api/public/artworks': {success:true, data:[work], count:1, warnings:[]},
            '/api/moderation/access': {enabled:true,setupEnabled:true,eligible:true,authenticated:true,wallet:artist,
                serverTime:1000,access:{role:'admin',dualWallet:true,stepUpActive:true,stepUpExpiresAt:3601000,wallet:artist}},
            '/api/moderation/aura-border': {enabled:true,revision:0,sourcesEnabled:false},
            '/api/moderation/review-queue': {reports:[],events:[],hidden:[],moderationLog:[],notifications:[]}
        };
        return route.fulfill({json:fixtures[url.pathname] || {}});
    }
    const file = path.resolve(dist, '.' + url.pathname);
    if (!file.startsWith(dist + path.sep)) return route.abort();
    const ext = path.extname(file);
    // Vercel serves the unbundled public scripts alongside Vite assets.
    const relative = path.relative(dist,file);
    for (const source of [file,...(['.js','.css'].includes(ext)?[path.resolve(relative)]:[])]) {
        try {
            const body = await fs.readFile(source);
            return route.fulfill({body,contentType:mime[ext] || 'application/octet-stream'});
        } catch {}
    }
    return route.abort();
}

// Sample the browser's actual glyph geometry. Decoding path coordinates alone
// would miss dropped letters and WebKit layout errors at a path boundary.
function measure(track) {
    const svg = track.querySelector('svg');
    svg.pauseAnimations();
    const path = svg.querySelector('path'), labels = [...svg.querySelectorAll('text')];
    const length = path.getTotalLength() / 3, seconds = parseFloat(svg.querySelector('animate').getAttribute('dur'));
    const bounds = svg.getBoundingClientRect(), w = bounds.width, h = bounds.height;
    function sample(fraction, straight = false) {
        svg.setCurrentTime(((fraction + 1) % 1) * seconds);
        const word = labels.reduce((a,b) => +getComputedStyle(a).opacity > +getComputedStyle(b).opacity ? a : b);
        assertWord(word);
        if (straight) for (let i=0; i<word.getNumberOfChars(); i++) {
            const a = word.getStartPositionOfChar(i), b = word.getEndPositionOfChar(i);
            const x = (a.x+b.x)/2, y = (a.y+b.y)/2;
            if (x<=0 || y<=0 || x>=w || y>=h) throw Error('Glyph outside frame on a straight rail: ' + track.dataset.word);
        }
        const i = Math.floor(word.getNumberOfChars()/2);
        const start = word.getStartPositionOfChar(i), end = word.getEndPositionOfChar(i);
        return {x:(start.x+end.x)/2, y:(start.y+end.y)/2, angle:word.getRotationOfChar(i),
            opacity:+getComputedStyle(word).opacity, wordLength:word.getComputedTextLength(), chars:word.getNumberOfChars()};
    }
    function assertWord(text) {
        const expected = track.dataset.word;
        if (text.querySelector('textPath').textContent !== expected || text.getNumberOfChars() !== expected.length ||
            labels.filter(label => Number(getComputedStyle(label).opacity) > 0).length !== 1) throw Error('Incorrect or overlapping moving caption: ' + expected);
    }
    function nearest(x,y) {
        let best = 0, minimum = Infinity;
        for (let at=0; at<length; at+=2) {
            const p = path.getPointAtLength(at), d = Math.hypot(x-p.x,y-p.y);
            if (d<minimum) {minimum=d;best=at;}
        }
        return best / length;
    }
    const sides = [[w/2,0],[w,h/2],[w/2,h],[0,h/2]].map(([x,y]) => {
        const t = nearest(x,y), a = sample(t,true), b = sample(t+0.25/seconds);
        return {angle:a.angle, speed:Math.hypot(a.x-b.x,a.y-b.y)*4};
    });
    let maxCornerStep = 0, minOpacity = 1;
    for (const [x,y] of [[0,0],[w,0],[w,h],[0,h]]) {
        const t = nearest(x,y);
        let previous;
        for (let i=-12; i<=12; i++) {
            const p = sample(t+i/24/seconds);
            if (p.chars !== track.dataset.word.length || p.wordLength < 15) throw Error('Letters lost at corner');
            if (previous) maxCornerStep = Math.max(maxCornerStep, Math.hypot(p.x-previous.x,p.y-previous.y));
            minOpacity = Math.min(minOpacity,p.opacity);
            previous=p;
        }
    }
    const top = nearest(w/2,0);
    const middle = sample(top);
    return {sides,maxCornerStep,minOpacity, speed:length/seconds,top,
        clear:!track.contains(document.elementFromPoint(bounds.left+middle.x,bounds.top+middle.y)),w,h};
}

async function sampleInk(page, track) {
    const style=await page.addStyleTag({content:'.future .artsoul-aura-frame::after { animation: none !important; }'});
    const frame=track.locator('xpath=../..');
    const shot=async()=> (await frame.screenshot({scale:'css'})).toString('base64');
    const ink=await shot();
    await track.evaluate(el=>el.style.visibility='hidden');
    const strip=await shot();
    await track.evaluate(el=>{el.style.visibility='';});
    await style.evaluate(el=>el.remove());
    const matched=await page.evaluate(async buffers=>{
        const pixels=await Promise.all(buffers.map(async buffer=>{
            const img=new Image();img.src='data:image/png;base64,'+buffer;await img.decode();
            const canvas=document.createElement('canvas'); canvas.width=120;canvas.height=26;
            const ctx=canvas.getContext('2d');
            ctx.drawImage(img,-Math.round(img.width/2)+60,0);
            return ctx.getImageData(0,0,120,26).data;
        }));
        const [ink,strip]=pixels;
        let matches=0;
        for(let i=0; i<ink.length;i+=4) {
            const delta=(a,b)=>Math.max(...[0,1,2].map(c=>Math.abs(a[i+c]-b[i+c])));
            if(delta(ink,strip)>40 && ink[i+2]>ink[i+1]+70 && ink[i]>ink[i+1]+50) matches++;
        }
        return matches;
    },[ink,strip]);
    assert(matched>=4,`Expected solid glyph pixels with the original violet caption color; got ${matched}`);
    return matched;
}

async function run(engine) {
    const name = engine.name();
    const opts = name === 'chromium' ? {channel:process.env.CHROMIUM_CHANNEL,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--mute-audio']}
        : {executablePath:process.env.WEBKIT_EXECUTABLE_PATH};
    const browser = await engine.launch(opts);
    try {
        const mobile = name === 'webkit';
        const context = await browser.newContext({viewport:mobile?{width:430,height:932}:{width:1440,height:960},isMobile:mobile,hasTouch:mobile});
        await context.addInitScript(()=>localStorage.setItem('artsoul_theme','future'));
        let displayedWork = artwork;
        await context.route('**/*', route => serveBuild(route, displayedWork));
        const page = await context.newPage();
        page.setDefaultTimeout(7000);
        for (const [route,selector] of [
            ['/index.html','.home-showcase-slide'],['/gallery.html#nft','.artsoul-artwork-card'],['/artwork.html?id=13','.artwork-detail-frame']
        ]) {
            await page.goto(origin+route, {waitUntil:'domcontentloaded'});
            const track = page.locator(selector + ' > .artsoul-aura-caption > artsoul-aura-track').first();
            await track.scrollIntoViewIfNeeded();
            await track.locator('svg').waitFor({state:'visible'});
            const r = await track.evaluate(measure);
            console.log(name,selector,JSON.stringify(r));
            assert(Math.abs(r.speed-48)<0.25 && r.sides.every(s=>Math.abs(s.speed-48)<2), 'Uniform speed');
            assert(r.sides.every((s,i)=>Math.abs((s.angle-(i%2?90:0)+540)%360-180)<2), 'Reading direction');
            assert(r.minOpacity>=.48 && r.maxCornerStep<22 && r.clear,'Continuous, click-through corners');
            if (process.env.ARTSOUL_QA_SHOTS) await page.screenshot({path:path.join(process.env.ARTSOUL_QA_SHOTS,name+'-'+selector.slice(1)+'.png')});
            if(selector==='.artwork-detail-frame') console.log(name,'matching ink pixels', await sampleInk(page,track));
        }
        const track = page.locator('.artwork-detail-frame artsoul-aura-track').first();
        await track.evaluate(el=>{document.body.style.paddingBottom='300vh';window.scrollTo(0,document.body.scrollHeight);});
        await page.waitForFunction(()=>!document.querySelector('.artwork-detail-frame artsoul-aura-track').hasAttribute('data-running'));
        assert(await track.evaluate(el=>el.firstElementChild.animationsPaused()));
        await track.scrollIntoViewIfNeeded();
        await page.waitForFunction(()=>document.querySelector('.artwork-detail-frame artsoul-aura-track').hasAttribute('data-running'));
        assert(!await track.evaluate(el=>el.firstElementChild.animationsPaused()));
        await page.emulateMedia({reducedMotion:'reduce'});
        assert(await page.locator('.artwork-detail-frame .aura-word').isVisible());
        assert(!await track.isVisible());
        await page.emulateMedia({reducedMotion:'no-preference'});
        for (const [kind,word] of [['genesis','ArtSoul Genesis'],['partner','ArtSoul Partner'],['founder','ArtSoul Founder']]) {
            await page.evaluate(({kind,word})=>{
                const frame=document.querySelector('.artwork-detail-frame');
                frame.classList.remove('artsoul-aura-frame--platform','artsoul-aura-frame--genesis','artsoul-aura-frame--founder','artsoul-aura-frame--partner');
                frame.classList.add('artsoul-aura-frame--'+kind);
                frame.replaceChildren(window.ArtSoulArtworkCard.createAuraCaption(word));
            },{kind,word});
            await page.locator('.artwork-detail-frame artsoul-aura-track[data-running] svg').waitFor();
            await track.evaluate(measure);
            await page.emulateMedia({reducedMotion:'reduce'});
            assert(await page.locator('.artwork-detail-frame .aura-word').isVisible());
            await page.emulateMedia({reducedMotion:'no-preference'});
        }
        await page.evaluate(()=>{
            document.body.classList.replace('future','classic');
            document.documentElement.classList.replace('future','classic');
        });
        assert(!await track.isVisible(),'Classic has no moving caption');
        displayedWork = {...artwork, aura_kind:'founder', founder_origin_verified:true, creator_identity_verified:true};
        for (const [route, creatorSelector] of [
            ['/index.html','.home-showcase-creator'], ['/gallery.html#nft','.artsoul-card-creator'],
            ['/artwork.html?id=13','.artwork-ownership-row']
        ]) {
            await page.goto(origin+route, {waitUntil:'domcontentloaded'});
            const mark = page.locator(creatorSelector).getByTitle('Work by the ArtSoul founder').first();
            await mark.waitFor();
            assert.equal((await mark.innerText()).trim(),'Founder');
            assert.equal(await mark.locator('img').count(),0);
            assert.equal(await page.locator('[title="Official ArtSoul NFT"]').count(),0);
        }
        // A stable fixture identity exercises the real appearance component
        // without connecting a browser wallet or initiating a sign-in.
        await page.addInitScript(wallet => {
            if (location.pathname !== '/admin.html') return;
            for (const [key,value] of Object.entries({
                currentWalletAddress:wallet,getCurrentWalletAddress:()=>wallet,artsoulWalletStateSettled:true,
                SupabaseAuth:{getAuthenticatedWallet:()=>wallet}
            })) Object.defineProperty(window,key,{configurable:true,get:()=>value,set:()=>{}});
        },artist);
        await page.goto(origin+'/admin.html#nft-appearance',{waitUntil:'domcontentloaded'});
        const preview=page.locator('.admin-aura-preview');
        await preview.waitFor().catch(async error=>{
            console.error('Admin preview state', await page.locator('main').innerText());
            throw error;
        });
        await preview.scrollIntoViewIfNeeded();
        for (const [kind,word] of [['platform','ArtSoul'],['founder','ArtSoul Founder'],['genesis','ArtSoul Genesis'],['partner','ArtSoul Partner']]) {
            await preview.getByRole('combobox').selectOption(kind);
            assert.equal(await preview.locator('img').count(),kind === 'platform' ? 1 : 0);
            const selector='artsoul-aura-track[data-word="'+word+'"]';
            const track=preview.locator(selector);
            await track.locator('svg').waitFor();
            const r=await track.evaluate(measure);
            await track.evaluate((el,t)=>{const svg=el.querySelector('svg');svg.setCurrentTime(t*el.lap);},r.top);
            if(process.env.ARTSOUL_QA_SHOTS) await preview.screenshot({path:path.join(process.env.ARTSOUL_QA_SHOTS,name+'-admin-'+kind+'.png')});
            console.log(name,'admin',kind,word,r.minOpacity);
        }
        await page.goto(origin+'/docs-protocol.html#nft-frames',{waitUntil:'domcontentloaded'});
        const examples=page.locator('.protocol-frame-example');
        await examples.first().waitFor({state:'attached'});
        assert.equal(await examples.count(), 4);
        for(const element of await examples.all()){
            await element.scrollIntoViewIfNeeded(); const track=element.locator('artsoul-aura-track');
            await track.locator('svg').waitFor(); await track.evaluate(measure);
        }
    } finally { await browser.close(); }
}
(async()=>{await run(chromium);await run(webkit);})().catch(error=>{console.error(error);process.exitCode=1;});
